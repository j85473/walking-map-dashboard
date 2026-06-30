if (typeof globalThis.URL.canParse !== 'function') {
  globalThis.URL.canParse = function(url: string) {
    try { new URL(url); return true; } catch { return false; }
  };
}
import { PrismaClient } from '@prisma/client/index.js'

const globalForPrisma = global as unknown as { prisma: PrismaClient }

export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({ log: ['info'] })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
