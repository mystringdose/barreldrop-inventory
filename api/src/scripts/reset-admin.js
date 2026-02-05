import dotenv from 'dotenv';
dotenv.config();

import { connectDb } from '../lib/db.js';
import { User } from '../models/User.js';

async function run() {
  await connectDb();
  const admin = await User.findOne({ role: 'admin' });
  if (!admin) {
    console.log('No admin user found');
    process.exit(1);
  }
  const newHash = await User.hashPassword('secret123');
  admin.passwordHash = newHash;
  admin.forcePasswordChange = true;
  await admin.save();
  console.log('Updated admin password for:', admin.email);
  process.exit(0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
