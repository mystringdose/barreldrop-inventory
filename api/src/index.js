import dotenv from "dotenv";
import { connectDb } from "./lib/db.js";
import app from "./app.js";

// load envs before starting
dotenv.config();

const PORT = process.env.PORT || 4000;

await connectDb();

app.listen(PORT, () => {
  console.log(`API listening on ${PORT}`);
});
