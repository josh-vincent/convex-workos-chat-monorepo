"use node";
// convex/compliancePack.ts — "use node" action: produces a REAL merged PDF compliance pack.
//
// Steps:
//   1. runQuery compliance.packData  → manifest (inspections, actions, registers, counts)
//   2. For each inspection fetch reportData + photo bytes → buildInspectionPdf
//   3. Build a cover page (org/anchor name, generated date, register-currency summary)
//   4. Merge cover + all inspection PDFs via PDFDocument.create() + copyPages
//   5. ctx.storage.store → return signed URL (application/pdf)

import { action } from "./_generated/server";
import { v } from "convex/values";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import {
  buildInspectionPdf,
  type ReportData,
  clean,
  fmtDate,
  INK,
  MUTED,
  HIVIS,
  PASS,
  FAIL,
  LINE,
  PAGE_W,
  PAGE_H,
  PAGE_M,
} from "./lib/buildInspectionPdf";

// ── Cover-page builder ──────────────────────────────────────────────────────

async function buildCoverPage(opts: {
  orgName: string;
  anchorLabel: string;
  anchorType: string;
  generatedAt: number;
  counts: { inspections: number; actions: number; registers: number; mediaIds: number };
  registers: {
    label: string;
    registerType: string;
    status: string;
    expiresAt?: number;
    issuedAt?: number;
  }[];
}): Promise<Uint8Array> {
  const { orgName, anchorLabel, anchorType, generatedAt, counts, registers } = opts;

  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const W = PAGE_W;
  const H = PAGE_H;
  const M = PAGE_M;
  const maxW = W - M * 2;

  let page = pdf.addPage([W, H]);
  let y = H - M;
  let pageNo = 1;

  const wrap = (s: string, size: number, f = font, width = maxW): string[] => {
    const words = clean(s).split(/\s+/).filter(Boolean);
    const lines: string[] = [];
    let ln = "";
    for (const w of words) {
      const next = ln ? `${ln} ${w}` : w;
      if (f.widthOfTextAtSize(next, size) > width && ln) {
        lines.push(ln);
        ln = w;
      } else ln = next;
    }
    if (ln) lines.push(ln);
    return lines.length ? lines : [""];
  };

  const footer = () => {
    page.drawText(`Generated ${fmtDate(Date.now())}  -  Beacon Safety`, {
      x: M,
      y: 28,
      size: 8,
      font,
      color: MUTED,
    });
    page.drawText(`Page ${pageNo}`, {
      x: W - M - 40,
      y: 28,
      size: 8,
      font,
      color: MUTED,
    });
  };

  const need = (h: number) => {
    if (y - h < M + 24) {
      footer();
      page = pdf.addPage([W, H]);
      pageNo += 1;
      y = H - M;
    }
  };

  const para = (
    s: string,
    size: number,
    f = font,
    color = INK,
    x = M,
    gap = 4,
  ) => {
    for (const lnText of wrap(s, size, f, W - M - x)) {
      need(size + gap);
      page.drawText(lnText, { x, y: y - size, size, font: f, color });
      y -= size + gap;
    }
  };

  // ── Header ────────────────────────────────────────────────────────────────
  para(clean(orgName).toUpperCase(), 9, bold, MUTED, M, 6);
  para("COMPLIANCE PACK", 26, bold, INK, M, 6);

  // Anchor subtitle
  const anchorTypeLabel =
    anchorType.charAt(0).toUpperCase() + anchorType.slice(1);
  para(`${anchorTypeLabel}: ${clean(anchorLabel)}`, 14, bold, INK, M, 4);
  para(`Generated: ${fmtDate(generatedAt)}`, 10, font, MUTED, M, 10);

  y -= 6;
  page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 1.5, color: LINE });
  y -= 20;

  // ── Summary counts ────────────────────────────────────────────────────────
  need(60);
  para("SUMMARY", 11, bold, HIVIS, M, 6);

  const colW = maxW / 4;
  const summaryItems: [string, number][] = [
    ["Inspections", counts.inspections],
    ["Actions", counts.actions],
    ["Register entries", counts.registers],
    ["Media files", counts.mediaIds],
  ];

  // Draw 4 count boxes in a row.
  const boxH = 50;
  need(boxH + 12);
  for (let i = 0; i < summaryItems.length; i++) {
    const [label, count] = summaryItems[i];
    const bx = M + i * colW;
    page.drawRectangle({
      x: bx + 2,
      y: y - boxH,
      width: colW - 4,
      height: boxH,
      color: rgb(0.97, 0.97, 0.97),
      borderColor: LINE,
      borderWidth: 1,
    });
    page.drawText(String(count), {
      x: bx + 12,
      y: y - 28,
      size: 22,
      font: bold,
      color: INK,
    });
    page.drawText(clean(label), {
      x: bx + 12,
      y: y - 44,
      size: 8,
      font,
      color: MUTED,
    });
  }
  y -= boxH + 16;

  // ── Register currency summary table ───────────────────────────────────────
  if (registers.length > 0) {
    y -= 8;
    need(20);
    para("REGISTER CURRENCY", 11, bold, HIVIS, M, 6);

    page.drawLine({ start: { x: M, y: y + 2 }, end: { x: W - M, y: y + 2 }, thickness: 0.75, color: LINE });
    y -= 6;

    // Column layout: label | type | status | expiry
    const col0 = M;
    const col1 = M + maxW * 0.38;
    const col2 = M + maxW * 0.62;
    const col3 = M + maxW * 0.80;

    // Header row
    need(14);
    const hdrY = y - 10;
    page.drawText("Document / Licence", { x: col0, y: hdrY, size: 8, font: bold, color: MUTED });
    page.drawText("Type", { x: col1, y: hdrY, size: 8, font: bold, color: MUTED });
    page.drawText("Status", { x: col2, y: hdrY, size: 8, font: bold, color: MUTED });
    page.drawText("Expires", { x: col3, y: hdrY, size: 8, font: bold, color: MUTED });
    y -= 14;
    page.drawLine({ start: { x: M, y: y + 1 }, end: { x: W - M, y: y + 1 }, thickness: 0.5, color: LINE });
    y -= 2;

    for (const reg of registers) {
      need(14);
      const rowY = y - 10;

      const statusColor =
        reg.status === "current" ? PASS :
        reg.status === "expired" ? FAIL :
        reg.status === "expiring_soon" ? HIVIS :
        MUTED;

      // Truncate label if too wide
      const maxLabelW = col1 - col0 - 6;
      const labelWrapped = wrap(reg.label, 9, font, maxLabelW);

      page.drawText(clean(labelWrapped[0] ?? reg.label), {
        x: col0,
        y: rowY,
        size: 9,
        font,
        color: INK,
      });
      page.drawText(clean(reg.registerType), {
        x: col1,
        y: rowY,
        size: 9,
        font,
        color: MUTED,
      });
      page.drawText(clean(reg.status.replace(/_/g, " ")), {
        x: col2,
        y: rowY,
        size: 9,
        font: bold,
        color: statusColor,
      });
      page.drawText(fmtDate(reg.expiresAt), {
        x: col3,
        y: rowY,
        size: 9,
        font,
        color: MUTED,
      });

      y -= 13;
      page.drawLine({ start: { x: M, y: y + 1 }, end: { x: W - M, y: y + 1 }, thickness: 0.25, color: LINE });
    }
  }

  footer();
  return await pdf.save();
}

// ── Main action ─────────────────────────────────────────────────────────────

export const pack = action({
  args: {
    anchorType: v.union(
      v.literal("job"),
      v.literal("site"),
      v.literal("contract"),
      v.literal("person"),
      v.literal("asset"),
    ),
    anchorId: v.string(),
  },
  handler: async (ctx, { anchorType, anchorId }): Promise<string> => {
    // ── 1. Fetch manifest ──────────────────────────────────────────────────
    const manifest = await ctx.runQuery(api.compliance.packData, {
      anchorType,
      anchorId,
    });

    // ── 2. Resolve org name & anchor display name ──────────────────────────
    // We use the first inspection's orgId to look up the org name.
    // For anchor name we do a best-effort lookup via runQuery on the
    // appropriate table using the internal helper below.
    const anchorInfo = await ctx.runQuery(
      internal.compliancePackData.resolveAnchor,
      { anchorType, anchorId },
    );

    const orgName = anchorInfo.orgName ?? "Organization";
    const anchorLabel = anchorInfo.anchorName ?? anchorId;

    // ── 3. Build cover page ────────────────────────────────────────────────
    const coverBytes = await buildCoverPage({
      orgName,
      anchorLabel,
      anchorType,
      generatedAt: Date.now(),
      counts: manifest.counts,
      registers: manifest.registers.map((r) => ({
        label: r.label,
        registerType: r.registerType,
        status: r.status,
        expiresAt: r.expiresAt,
        issuedAt: r.issuedAt,
      })),
    });

    // ── 4. Build per-inspection PDFs ───────────────────────────────────────
    const inspectionPdfBytesArr: Uint8Array[] = [];

    for (const insp of manifest.inspections) {
      // Fetch the rich report data (template sections, inspector name, etc.)
      const reportData = (await ctx.runQuery(
        internal.reportData.forInspection,
        { inspectionId: insp._id as Id<"inspections"> },
      )) as ReportData | null;

      if (!reportData) continue;

      // Fetch photo bytes
      const photoBytes = new Map<string, Uint8Array>();
      for (const r of reportData.responses) {
        for (const m of r.media ?? []) {
          if (m.kind === "doc" || photoBytes.has(m.storageId)) continue;
          try {
            const blob = await ctx.storage.get(m.storageId as Id<"_storage">);
            if (blob) {
              photoBytes.set(m.storageId, new Uint8Array(await blob.arrayBuffer()));
            }
          } catch {
            /* missing blob — skip */
          }
        }
      }

      const bytes = await buildInspectionPdf(reportData, photoBytes);
      inspectionPdfBytesArr.push(bytes);
    }

    // ── 5. Merge all PDFs ──────────────────────────────────────────────────
    const merged = await PDFDocument.create();

    const copyFrom = async (bytes: Uint8Array) => {
      const src = await PDFDocument.load(bytes);
      const pageIndices = src.getPageIndices();
      const pages = await merged.copyPages(src, pageIndices);
      for (const p of pages) merged.addPage(p);
    };

    await copyFrom(coverBytes);
    for (const b of inspectionPdfBytesArr) {
      await copyFrom(b);
    }

    const mergedBytes = await merged.save();

    // ── 6. Store in Convex file storage & return URL ───────────────────────
    const storageId = await ctx.storage.store(
      new Blob([mergedBytes as unknown as BlobPart], { type: "application/pdf" }),
    );

    const url = await ctx.storage.getUrl(storageId);
    if (!url) throw new Error("Failed to get storage URL for compliance pack");
    return url;
  },
});
