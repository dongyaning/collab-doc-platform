/**
 * Seeds demo accounts so M1 can be tested end-to-end without a signup UI.
 * Run with: `pnpm --filter @wiseflow/server seed`
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

    // Seed a demo knowledge base with a nested tree.
    const existingKbs = await prisma.knowledgeBase.count({
      where: { ownerId: user.id },
    });
    if (existingKbs === 0) {
      const kb = await prisma.knowledgeBase.create({
        data: {
          title: `${seedUser.name}'s Wiki`,
          description: 'Demo knowledge base with a hierarchical document tree.',
          ownerId: user.id,
        },
      });

      // Create root node for the KB
      const rootNode = await prisma.node.create({
        data: {
          kbId: kb.id,
          type: 'FOLDER',
          title: `${seedUser.name}'s Wiki`,
          content: { type: 'doc', content: [] },
        },
      });
      await prisma.knowledgeBase.update({
        where: { id: kb.id },
        data: { rootNodeId: rootNode.id },
      });
      await prisma.user.update({
        where: { id: user.id },
        data: { defaultKbId: kb.id },
      });

      const docContent = (heading: string, body: string) => ({
        type: 'doc',
        content: [
          {
            type: 'heading',
            attrs: { level: 1 },
            content: [{ type: 'text', text: heading }],
          },
          {
            type: 'paragraph',
            content: [{ type: 'text', text: body }],
          },
        ],
      });

      // Root document
      await prisma.node.create({
        data: {
          kbId: kb.id,
          type: 'DOC',
          title: 'Home',
          sortOrder: 0,
          content: docContent('Home', 'Welcome to the knowledge base.'),
        },
      });

      // A folder with two child docs
      const guides = await prisma.node.create({
        data: {
          kbId: kb.id,
          type: 'FOLDER',
          title: 'Guides',
          sortOrder: 1,
        },
      });
      await prisma.node.create({
        data: {
          kbId: kb.id,
          parentId: guides.id,
          type: 'DOC',
          title: 'Getting Started',
          sortOrder: 0,
          content: docContent('Getting Started', 'How to use this wiki.'),
        },
      });
      const advanced = await prisma.node.create({
        data: {
          kbId: kb.id,
          parentId: guides.id,
          type: 'DOC',
          title: 'Advanced Usage',
          sortOrder: 1,
          content: docContent('Advanced Usage', 'Deep-dive topics.'),
        },
      });
      // A grandchild doc under "Advanced Usage"
      await prisma.node.create({
        data: {
          kbId: kb.id,
          parentId: advanced.id,
          type: 'DOC',
          title: 'Tips & Tricks',
          sortOrder: 0,
          content: docContent('Tips & Tricks', 'Nested document example.'),
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
