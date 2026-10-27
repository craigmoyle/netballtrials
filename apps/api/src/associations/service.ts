import type { MemberAssociation, PrismaClient } from '@prisma/client';
import type { PublicAssociationDTO } from '@netball-trials/types';

export async function listAssociations(prisma: PrismaClient): Promise<MemberAssociation[]> {
  return prisma.memberAssociation.findMany({ orderBy: { name: 'asc' } });
}

export async function listActiveAssociations(prisma: PrismaClient): Promise<PublicAssociationDTO[]> {
  return prisma.memberAssociation.findMany({
    where: { active: true },
    orderBy: { name: 'asc' },
    select: { id: true, name: true, active: true },
  });
}

export async function createAssociation(
  prisma: PrismaClient,
  input: { name: string; primaryContactName?: string | null; primaryContactEmail?: string | null },
): Promise<MemberAssociation> {
  return prisma.memberAssociation.create({
    data: {
      name: input.name.trim(),
      primaryContactName: input.primaryContactName?.trim() || null,
      primaryContactEmail: input.primaryContactEmail?.trim().toLowerCase() || null,
    },
  });
}

export async function updateAssociation(
  prisma: PrismaClient,
  id: string,
  patch: { active?: boolean; primaryContactName?: string | null; primaryContactEmail?: string | null },
): Promise<MemberAssociation | null> {
  const existing = await prisma.memberAssociation.findUnique({ where: { id } });
  if (!existing) {
    return null;
  }
  return prisma.memberAssociation.update({
    where: { id },
    data: {
      ...(patch.active !== undefined ? { active: patch.active } : {}),
      ...(patch.primaryContactName !== undefined ? { primaryContactName: patch.primaryContactName?.trim() || null } : {}),
      ...(patch.primaryContactEmail !== undefined ? { primaryContactEmail: patch.primaryContactEmail?.trim().toLowerCase() || null } : {}),
    },
  });
}
