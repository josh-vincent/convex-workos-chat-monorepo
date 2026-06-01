// convex/lib/buildInspectionPdf.ts
//
// Pure pdf-lib helper — builds a single-inspection PDF.
// No Convex runtime imports; safe to call from any "use node" action.
//
// Extracted from convex/reports.tsx so it can also be used by compliancePack.ts.

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

export const INK = rgb(0.13, 0.13, 0.14);
export const MUTED = rgb(0.46, 0.46, 0.48);
export const HIVIS = rgb(0.78, 0.56, 0.06);
export const PASS = rgb(0.16, 0.5, 0.32);
export const FAIL = rgb(0.72, 0.16, 0.16);
export const LINE = rgb(0.82, 0.82, 0.83);

export const PAGE_W = 595.28;
export const PAGE_H = 841.89;
export const PAGE_M = 48;

export type Question = { id: string; label: string; type: string; unit?: string };
export type Section = { title: string; questions: Question[] };
export type ReportData = {
  orgId: string;
  orgName: string;
  templateName: string;
  templateCategory?: string;
  version: number;
  sections: Section[];
  scoringEnabled?: boolean;
  responses: {
    questionId: string;
    value?: unknown;
    note?: string;
    flagged?: boolean;
    media?: { storageId: string; kind: string; name: string | null }[];
  }[];
  score?: number;
  inspectorName?: string;
  siteName?: string;
  startedAt?: number;
  completedAt?: number;
};

/** WinAnsi-safe: map common unicode to ASCII and drop anything pdf-lib can't encode. */
export function clean(s: string): string {
  const mapped = (s ?? "")
    .replace(/[—–]/g, "-")
    .replace(/['']/g, "'")
    .replace(/[""]/g, '"')
    .replace(/→/g, ">")
    .replace(/[•·]/g, "-");
  return Array.from(mapped)
    .map((c) => (c.charCodeAt(0) <= 255 ? c : ""))
    .join("");
}

export function fmtDate(ts?: number): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleDateString("en-AU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function answerText(value: unknown): { text: string; color: ReturnType<typeof rgb> } {
  if (value === undefined || value === null || value === "")
    return { text: "Not answered", color: MUTED };
  if (value === true) return { text: "Yes", color: PASS };
  if (value === false) return { text: "No", color: INK };
  if (typeof value === "object" && value !== null && "hazard" in value) {
    const cm = value as { hazard?: string; riskRating?: string; controlLevel?: string; control?: string };
    const level = cm.controlLevel ? cm.controlLevel.charAt(0).toUpperCase() + cm.controlLevel.slice(1) : "-";
    const risk = cm.riskRating ? cm.riskRating.charAt(0).toUpperCase() + cm.riskRating.slice(1) : "-";
    const text = `Hazard: ${cm.hazard ?? "-"} | Risk: ${risk} | Control (${level}): ${cm.control ?? "-"}`;
    return { text, color: INK };
  }
  const s = String(value);
  if (s === "pass") return { text: "PASS", color: PASS };
  if (s === "fail") return { text: "FAIL", color: FAIL };
  if (s === "na") return { text: "N/A", color: MUTED };
  return { text: s, color: INK };
}

export async function buildInspectionPdf(
  data: ReportData,
  photoBytes: Map<string, Uint8Array>,
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const oblique = await pdf.embedFont(StandardFonts.HelveticaOblique);

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

  // ── Header ──────────────────────────────────────────────────────────────
  para(data.orgName.toUpperCase(), 9, bold, MUTED, M, 6);
  para("SAFETY INSPECTION REPORT", 22, bold, INK, M, 6);
  para(data.templateName, 13, bold, INK, M, 3);
  if (data.templateCategory) para(data.templateCategory, 10, font, MUTED, M, 8);

  y -= 6;
  page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 1, color: LINE });
  y -= 18;

  // ── Meta ──────────────────────────────────────────────────────────────────
  const meta: [string, string][] = [
    ["Inspector", data.inspectorName ?? "—"],
    ["Site", data.siteName ?? "—"],
    ["Started", fmtDate(data.startedAt)],
    ["Completed", fmtDate(data.completedAt)],
    ["Version", `v${data.version}`],
  ];
  for (const [k, val] of meta) {
    need(15);
    page.drawText(k, { x: M, y: y - 10, size: 9, font, color: MUTED });
    page.drawText(clean(val), { x: M + 80, y: y - 10, size: 10, font: bold, color: INK });
    y -= 15;
  }

  // ── Score banner ────────────────────────────────────────────────────────
  if (data.scoringEnabled !== false && data.score != null) {
    y -= 8;
    need(40);
    const scoreColor = data.score >= 90 ? PASS : data.score >= 70 ? HIVIS : FAIL;
    page.drawRectangle({
      x: M,
      y: y - 34,
      width: maxW,
      height: 34,
      color: rgb(0.97, 0.96, 0.93),
      borderColor: LINE,
      borderWidth: 1,
    });
    page.drawText("SCORE", { x: M + 12, y: y - 22, size: 11, font: bold, color: MUTED });
    page.drawText(`${Math.round(data.score)}%`, {
      x: M + 70,
      y: y - 24,
      size: 18,
      font: bold,
      color: scoreColor,
    });
    const flagged = data.responses.filter((r) => r.flagged).length;
    page.drawText(
      flagged
        ? `${flagged} flagged item${flagged > 1 ? "s" : ""}`
        : "No flagged items",
      {
        x: W - M - 140,
        y: y - 22,
        size: 10,
        font,
        color: flagged ? FAIL : MUTED,
      },
    );
    y -= 46;
  } else {
    y -= 10;
  }

  // ── Sections & answers ────────────────────────────────────────────────────
  const byId = new Map(data.responses.map((r) => [r.questionId, r]));
  for (const section of data.sections) {
    need(28);
    y -= 6;
    para(section.title.toUpperCase(), 11, bold, HIVIS, M, 4);
    page.drawLine({
      start: { x: M, y: y + 2 },
      end: { x: W - M, y: y + 2 },
      thickness: 0.75,
      color: LINE,
    });
    y -= 8;

    const THUMB = 64;
    const PER_ROW = 5;
    for (const q of section.questions) {
      if (q.type === "instruction") continue;
      const r = byId.get(q.id);
      const a = answerText(r?.value);
      const unit = q.unit && a.text !== "Not answered" ? ` ${q.unit}` : "";
      const labelLines = wrap(q.label, 10, bold);
      const noteLines = r?.note ? wrap(`Note: ${r.note}`, 9, oblique, W - M * 2 - 12) : [];
      const media = r?.media ?? [];
      const docs = media.filter((m) => m.kind === "doc");

      // Embed photo/signature images up front (so block height is known).
      const imgs: Awaited<ReturnType<typeof pdf.embedJpg>>[] = [];
      for (const m of media) {
        if (m.kind === "doc") continue;
        const bytes = photoBytes.get(m.storageId);
        if (!bytes) continue;
        try {
          imgs.push(await pdf.embedJpg(bytes));
        } catch {
          try {
            imgs.push(await pdf.embedPng(bytes));
          } catch {
            /* unsupported image — skip */
          }
        }
      }
      const photoRows = imgs.length ? Math.ceil(imgs.length / PER_ROW) : 0;
      const mediaH = photoRows * (THUMB + 6) + docs.length * 13;

      // Keep label + answer + note + evidence together — never split a question.
      need(labelLines.length * 13 + 16 + noteLines.length * 12 + mediaH + 8);

      for (const ln of labelLines) {
        page.drawText(ln, { x: M, y: y - 10, size: 10, font: bold, color: INK });
        y -= 13;
      }
      page.drawText(`Answer:  ${clean(a.text)}${clean(unit)}`, {
        x: M + 12,
        y: y - 10,
        size: 10,
        font: bold,
        color: a.color,
      });
      if (r?.flagged) {
        page.drawText("FLAGGED", {
          x: W - M - 60,
          y: y - 10,
          size: 9,
          font: bold,
          color: FAIL,
        });
      }
      y -= 16;
      for (const ln of noteLines) {
        page.drawText(ln, { x: M + 12, y: y - 9, size: 9, font: oblique, color: MUTED });
        y -= 12;
      }
      for (const d of docs) {
        page.drawText(`Attachment: ${clean(d.name ?? "document")}`, {
          x: M + 12,
          y: y - 9,
          size: 9,
          font,
          color: MUTED,
        });
        y -= 13;
      }
      // Photo thumbnails, wrapped to PER_ROW per row.
      for (let i = 0; i < imgs.length; i++) {
        if (i % PER_ROW === 0) y -= THUMB + 6;
        const col = i % PER_ROW;
        page.drawImage(imgs[i], {
          x: M + 12 + col * (THUMB + 6),
          y: y,
          width: THUMB,
          height: THUMB,
        });
      }
      y -= 8;
    }
  }

  footer();
  return await pdf.save();
}
