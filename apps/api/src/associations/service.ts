import { Prisma, type MemberAssociation, type PrismaClient } from '@prisma/client';
import type { PublicAssociationDTO } from '@netball-trials/types';

export class AssociationContactPairError extends Error {}

function normalizedContactPair(input: { primaryContactName?: string | null; primaryContactEmail?: string | null }) {
  const primaryContactName = input.primaryContactName === undefined ? undefined : input.primaryContactName?.trim() || null;
  const primaryContactEmail = input.primaryContactEmail === undefined ? undefined : input.primaryContactEmail?.trim().toLowerCase() || null;
  return { primaryContactName, primaryContactEmail };
}

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
  const contact = normalizedContactPair(input);
  return prisma.memberAssociation.create({
    data: { name: input.name.trim(), ...contact },
  });
}

export async function updateAssociation(
  prisma: PrismaClient,
  id: string,
  patch: { active?: boolean; primaryContactName?: string | null; primaryContactEmail?: string | null },
): Promise<MemberAssociation | null> {
  return prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id" FROM "MemberAssociation" WHERE "id" = ${id} FOR UPDATE
    `);
    if (!locked.length) return null;
    const existing = await tx.memberAssociation.findUniqueOrThrow({ where: { id } });
    const contact = normalizedContactPair(patch);
    const primaryContactName = contact.primaryContactName === undefined ? existing.primaryContactName : contact.primaryContactName;
    const primaryContactEmail = contact.primaryContactEmail === undefined ? existing.primaryContactEmail : contact.primaryContactEmail;
    if (Boolean(primaryContactName) !== Boolean(primaryContactEmail)) {
      throw new AssociationContactPairError('Primary contact name and email must be provided together.');
    }
    return tx.memberAssociation.update({
      where: { id },
      data: {
        ...(patch.active !== undefined ? { active: patch.active } : {}),
        ...(contact.primaryContactName !== undefined ? { primaryContactName } : {}),
        ...(contact.primaryContactEmail !== undefined ? { primaryContactEmail } : {}),
      },
    });
  });
}
