/**
 * Seeds demo accounts so M1 can be tested end-to-end without a signup UI.
 * Run with: `pnpm --filter @collab/server seed`
 */
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const seedUsers = [
  {
    email: process.env.SEED_USER_EMAIL ?? 'demo@collab.dev',
    password: process.env.SEED_USER_PASSWORD ?? 'demo1234',
    name: process.env.SEED_USER_NAME ?? 'Demo',
  },
  {
    email: process.env.SEED_SECOND_USER_EMAIL ?? 'reviewer@collab.dev',
    password: process.env.SEED_SECOND_USER_PASSWORD ?? 'reviewer1234',
    name: process.env.SEED_SECOND_USER_NAME ?? 'Reviewer',
  },
];

async function main() {
  for (const seedUser of seedUsers) {
    const passwordHash = await bcrypt.hash(seedUser.password, 10);

    const user = await prisma.user.upsert({
      where: { email: seedUser.email },
      update: { passwordHash, name: seedUser.name },
      create: { email: seedUser.email, name: seedUser.name, passwordHash },
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

    console.log(`[seed] user=${seedUser.email} password=${seedUser.password}`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
