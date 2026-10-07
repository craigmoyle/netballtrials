import type { MemberAssociation, PrismaClient } from '@prisma/client';

export async function listAssociations(prisma: PrismaClient): Promise<MemberAssociation[]> {
  return prisma.memberAssociation.findMany({ orderBy: { name: 'asc' } });
}

export async function createAssociation(
  prisma: PrismaClient,
  name: string,
): Promise<MemberAssociation> {
  return prisma.memberAssociation.create({ data: { name: name.trim() } });
}

export async function setAssociationActive(
  prisma: PrismaClient,
  id: string,
  active: boolean,
): Promise<MemberAssociation | null> {
  const existing = await prisma.memberAssociation.findUnique({ where: { id } });
  if (!existing) {
    return null;
  }
  return prisma.memberAssociation.update({ where: { id }, data: { active } });
}
