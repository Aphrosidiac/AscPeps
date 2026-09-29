// Prints the month-end wrap for a month without sending anything.
//   npx tsx scripts/preview-month-end.ts [YYYY-MM]
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { computeMonthEnd, monthEndText, currentMonth } from '../src/utils/month-end.js';

const prisma = new PrismaClient({ adapter: new PrismaPg(process.env.DATABASE_URL!) });
const month = process.argv[2] ?? currentMonth();
const report = await computeMonthEnd({ prisma } as any, month);
console.log(monthEndText(report));
if (process.argv.includes('--json')) console.log(JSON.stringify(report, null, 2));
await prisma.$disconnect();
