/**
 * Seeds a single demo account so M1 can be tested end-to-end without a signup UI.
 * Run with: `pnpm --filter @collab/server seed`
 */
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const email = process.env.SEED_USER_EMAIL ?? 'demo@collab.dev';
  const password = process.env.SEED_USER_PASSWORD ?? 'demo1234';
  const name = process.env.SEED_USER_NAME ?? 'Demo';

  const passwordHash = await bcrypt.hash(password, 10);

  const user = await prisma.user.upsert({
    where: { email },
    update: { passwordHash, name },
    create: { email, name, passwordHash },
  });

  const existingDocs = await prisma.document.count({ where: { ownerId: user.id } });
  if (existingDocs === 0) {
    await prisma.document.create({
      data: {
        title: 'Welcome to collab-doc-platform',
        ownerId: user.id,
        content: {
          type: 'doc',
          content: [
            {
              type: 'heading',
              attrs: { level: 1 },
              content: [{ type: 'text', text: 'Welcome' }],
            },
            {
              type: 'paragraph',
              content: [
                {
                  type: 'text',
                  text: 'This is the M1 single-user MVP. Multi-user collab lands in M2.',
                },
              ],
            },
          ],
        },
      },
    });
  }

  console.log(`[seed] user=${email} password=${password}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
