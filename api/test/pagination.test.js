// ensure test env vars before importing the app
process.env.JWT_SECRET = process.env.JWT_SECRET || "test-jwt";
process.env.NODE_ENV = "test";

import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import app from "../src/app.js";
import { User } from "../src/models/User.js";
import { Item } from "../src/models/Item.js";
import { Sale } from "../src/models/Sale.js";
import { StockReceipt } from "../src/models/StockReceipt.js";
import { AuditLog } from "../src/models/AuditLog.js";

let mongod;
let agent;
let adminUser;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri();
  await mongoose.connect(uri, { dbName: "test" });

  // create admin user
  const passwordHash = await User.hashPassword("secret123");
  adminUser = await User.create({ name: "Admin", email: "admin@example.com", passwordHash, role: "admin" });

  agent = request.agent(app);
  await agent.post("/auth/login").send({ email: "admin@example.com", password: "secret123" });
});

afterAll(async () => {
  await mongoose.disconnect();
  if (mongod) await mongod.stop();
});

afterEach(async () => {
  // clear collections but keep admin
  await Item.deleteMany({});
  await Sale.deleteMany({});
  await StockReceipt.deleteMany({});
  await AuditLog.deleteMany({});
  await User.deleteMany({ _id: { $ne: adminUser._id } });
});

test("items cursor pagination works", async () => {
  // insert 5 items A..E
  const names = ["Alpha", "Beta", "Charlie", "Delta", "Echo"];
  for (const n of names) {
    await Item.create({ name: n, sku: n.toUpperCase(), createdBy: adminUser._id });
  }

  const res1 = await agent.get("/items?limit=2").expect(200);
  expect(res1.body.items.length).toBe(2);
  expect(res1.body.nextCursor).toBeTruthy();

  const res2 = await agent.get(`/items?limit=2&cursor=${encodeURIComponent(res1.body.nextCursor)}&direction=next`).expect(200);
  expect(res2.body.items.length).toBe(2);
  expect(res2.body.items[0].name).toBe("Charlie");
});

test("non-admin user can create an item", async () => {
  const passwordHash = await User.hashPassword("secret123");
  const normalUser = await User.create({
    name: "Normal User",
    email: "user@example.com",
    passwordHash,
    role: "user",
  });

  const userAgent = request.agent(app);
  await userAgent.post("/auth/login").send({ email: "user@example.com", password: "secret123" }).expect(200);

  const res = await userAgent
    .post("/items")
    .send({ name: "User Item", sku: "USR-1", category: "wine", sellingPrice: 12.5 })
    .expect(200);

  expect(res.body.item.name).toBe("User Item");
  expect(res.body.item.createdBy.toString()).toBe(normalUser._id.toString());
});

test("duplicate sku is rejected", async () => {
  await agent.post("/items").send({ name: "First Item", sku: "dup-1", category: "wine" }).expect(200);

  const res = await agent.post("/items").send({ name: "Second Item", sku: "DUP-1", category: "beer" }).expect(409);
  expect(res.body.error).toBe("SKU already exists");
});

test("duplicate sku on update is rejected", async () => {
  const one = await Item.create({ name: "One", sku: "ONE-1", createdBy: adminUser._id });
  const two = await Item.create({ name: "Two", sku: "TWO-1", createdBy: adminUser._id });

  const res = await agent.patch(`/items/${two._id}`).send({ sku: "one-1" }).expect(409);
  expect(res.body.error).toBe("SKU already exists");
  const reloaded = await Item.findById(two._id).lean();
  expect(reloaded.sku).toBe("TWO-1");
  expect(one._id.toString()).not.toBe(two._id.toString());
});

test("cognac category is accepted", async () => {
  const res = await agent
    .post("/items")
    .send({ name: "Cognac Item", sku: "CAT-1", category: "cognac" })
    .expect(200);

  expect(res.body.item.category).toBe("cognac");
});

test("non-admin user can edit an item", async () => {
  const passwordHash = await User.hashPassword("secret123");
  const normalUser = await User.create({
    name: "Editor User",
    email: "editor@example.com",
    passwordHash,
    role: "user",
  });

  const item = await Item.create({
    name: "Editable",
    sku: "EDT-1",
    category: "wine",
    createdBy: normalUser._id,
  });

  const userAgent = request.agent(app);
  await userAgent.post("/auth/login").send({ email: "editor@example.com", password: "secret123" }).expect(200);

  const res = await userAgent
    .patch(`/items/${item._id}`)
    .send({ name: "Edited Name", sellingPrice: 25.0 })
    .expect(200);

  expect(res.body.item.name).toBe("Edited Name");
  expect(res.body.item.sellingPrice).toBe(25);
});

test("sale uses item selling price and ignores client-provided unit price", async () => {
  const item = await Item.create({
    name: "Priced Item",
    sku: "PRICE-1",
    category: "wine",
    sellingPrice: 15,
    createdBy: adminUser._id,
  });
  await StockReceipt.create({
    item: item._id,
    quantity: 5,
    remainingQuantity: 5,
    unitCost: 8,
    createdBy: adminUser._id,
  });

  const res = await agent
    .post("/sales")
    .send({
      items: [{ itemId: item._id.toString(), quantity: 2, unitPrice: 999 }],
    })
    .expect(200);

  expect(res.body.sale.items[0].unitPrice).toBe(15);
  expect(res.body.sale.totalRevenue).toBe(30);
});

test("failed multi-line sale does not persist staged stock deductions", async () => {
  const itemA = await Item.create({
    name: "Item A",
    sku: "ITEM-A",
    sellingPrice: 10,
    createdBy: adminUser._id,
  });
  const itemB = await Item.create({
    name: "Item B",
    sku: "ITEM-B",
    sellingPrice: 8,
    createdBy: adminUser._id,
  });

  const receiptA = await StockReceipt.create({
    item: itemA._id,
    quantity: 5,
    remainingQuantity: 5,
    unitCost: 3,
    createdBy: adminUser._id,
  });
  const receiptB = await StockReceipt.create({
    item: itemB._id,
    quantity: 1,
    remainingQuantity: 1,
    unitCost: 2,
    createdBy: adminUser._id,
  });

  await agent
    .post("/sales")
    .send({
      items: [
        { itemId: itemA._id.toString(), quantity: 2 },
        { itemId: itemB._id.toString(), quantity: 2 },
      ],
    })
    .expect(400);

  const freshA = await StockReceipt.findById(receiptA._id).lean();
  const freshB = await StockReceipt.findById(receiptB._id).lean();
  expect(freshA.remainingQuantity).toBe(5);
  expect(freshB.remainingQuantity).toBe(1);
});

test("sales date filter and cursor works", async () => {
  // Create two sales: one today and one yesterday
  const item = await Item.create({ name: "X", sku: "X1", createdBy: adminUser._id });
  const receipt = await StockReceipt.create({ item: item._id, quantity: 10, remainingQuantity: 10, unitCost: 1, createdBy: adminUser._id });

  // sale yesterday
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  await Sale.create({ items: [{ item: item._id, quantity: 1, unitPrice: 2, unitCost: 1, lineCost: 1, lineTotal: 2 }], totalRevenue: 2, totalCost: 1, profit: 1, soldAt: yesterday, createdBy: adminUser._id });

  // sale today
  await Sale.create({ items: [{ item: item._id, quantity: 1, unitPrice: 2, unitCost: 1, lineCost: 1, lineTotal: 2 }], totalRevenue: 2, totalCost: 1, profit: 1, soldAt: new Date(), createdBy: adminUser._id });

  const today = new Date().toISOString().slice(0, 10);
  const res = await agent.get(`/sales?start=${today}&end=${today}&limit=10`).expect(200);
  expect(res.body.sales.length).toBeGreaterThanOrEqual(1);
});

test("stock receipts cursor pagination works", async () => {
  const item = await Item.create({ name: "S1", sku: "S1", createdBy: adminUser._id });
  for (let i = 0; i < 5; i++) {
    await StockReceipt.create({ item: item._id, quantity: 5, remainingQuantity: 5, unitCost: i + 1, createdBy: adminUser._id });
  }

  const r1 = await agent.get("/stock-receipts?limit=2").expect(200);
  expect(r1.body.receipts.length).toBe(2);
  expect(r1.body.nextCursor).toBeTruthy();

  const r2 = await agent.get(`/stock-receipts?limit=2&cursor=${encodeURIComponent(r1.body.nextCursor)}&direction=next`).expect(200);
  expect(r2.body.receipts.length).toBe(2);
});

test("stock receipt rejects invalid and missing items", async () => {
  const resInvalid = await agent
    .post("/stock-receipts")
    .field("itemId", "not-an-object-id")
    .field("quantity", "5")
    .field("unitCost", "2")
    .attach("invoice", Buffer.from("invoice"), "invoice.txt")
    .expect(400);

  expect(resInvalid.body.error).toBe("Invalid item id");

  const missingId = new mongoose.Types.ObjectId().toString();
  const resMissing = await agent
    .post("/stock-receipts")
    .field("itemId", missingId)
    .field("quantity", "5")
    .field("unitCost", "2")
    .attach("invoice", Buffer.from("invoice"), "invoice.txt")
    .expect(404);

  expect(resMissing.body.error).toBe("Item not found");
});

test("audit cursor & date filter works", async () => {
  // create some audit logs
  await AuditLog.create({ actor: adminUser._id, action: "user.create", targetType: "User", targetId: adminUser._id, meta: { email: "foo@example.com" } });
  await AuditLog.create({ actor: adminUser._id, action: "user.delete", targetType: "User", targetId: adminUser._id, meta: {} });

  const today = new Date().toISOString().slice(0, 10);
  const res = await agent.get(`/audit?start=${today}&end=${today}&limit=10`).expect(200);
  expect(res.body.logs.length).toBeGreaterThanOrEqual(2);
});
