/**
 * One-time migration: moves legacy flat Document rows into KnowledgeBase/Node.
 *
 * For each user who owns Documents but has no KB yet, creates a
 * "Migrated Documents" knowledge base and inserts each Document as a root-level
 * Node (type DOC), preserving content, yjsState, version, and members.
 *
 * Run with: `pnpm --filter @collab/server tsx prisma/migrate-docs-to-nodes.ts`
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const users = await prisma.user.findMany({
    select: { id: true, email: true, name: true },
  });

  let totalMigrated = 0;

  for (const user of users) {
    const docs = await prisma.document.findMany({
      where: { ownerId: user.id },
      orderBy: { createdAt: 'asc' },
    });

    if (docs.length === 0) continue;

    // check if user already has KBs — skip if so (already migrated or seeded)
    const existingKbs = await prisma.knowledgeBase.count({
      where: { ownerId: user.id },
    });
    if (existingKbs > 0) {
      console.log(`[migrate] skip user=${user.email} (already has ${existingKbs} KB(s))`);
      continue;
    }

    const kb = await prisma.knowledgeBase.create({
      data: {
        title: 'Migrated Documents',
        description: 'Documents imported from the legacy flat list.',
        ownerId: user.id,
      },
    });

    for (let i = 0; i < docs.length; i += 1) {
      const doc = docs[i]!;

      const node = await prisma.node.create({
        data: {
          kbId: kb.id,
          parentId: null,
          type: 'DOC',
          title: doc.title,
          sortOrder: i,
          content: doc.content,
          yjsState: doc.yjsState,
          version: doc.version,
        },
      });

      // migrate versions
      const versions = await prisma.documentVersion.findMany({
        where: { documentId: doc.id },
        orderBy: { version: 'asc' },
      });
      for (const v of versions) {
        await prisma.nodeVersion.create({
          data: {
            nodeId: node.id,
            version: v.version,
            yjsState: v.yjsState,
            createdById: v.createdById,
            label: v.label,
          },
        });
      }

      // migrate members (DocumentMember → KbMember)
      const members = await prisma.documentMember.findMany({
        where: { documentId: doc.id },
      });
      for (const m of members) {
        await prisma.kbMember.upsert({
          where: { kbId_userId: { kbId: kb.id, userId: m.userId } },
          update: { role: m.role },
          create: { kbId: kb.id, userId: m.userId, role: m.role },
        });
      }

      totalMigrated += 1;
    }

    console.log(`[migrate] user=${user.email} → kb=${kb.id} docs=${docs.length}`);
  }

  console.log(`[migrate] done. ${totalMigrated} document(s) migrated.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
