// Monthly statement as a PDF: every settlement of the month, every deduction explained, refunds.
// Numbers come straight from the ledgers (rule 1); nothing here is written by a model.
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { db } from "@/lib/db";

const NAVY = rgb(0, 0.18, 0.43);
const SKY = rgb(0, 0.73, 0.95);
const INK = rgb(0.1, 0.12, 0.16);
const MUTED = rgb(0.42, 0.45, 0.5);
const RULE = rgb(0.88, 0.9, 0.93);
const IST = 5.5 * 3_600_000;
const LABEL: Record<string, string> = { RENT: "Soundbox/EDC rent", LATE_FEE: "Late fee", DISPUTE: "Dispute (chargeback)", LOAN_EMI: "Loan EMI", FEE: "Fee" };
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

// Standard PDF fonts are WinAnsi: no ₹, no Devanagari. "Rs" is how printed Indian statements spell it anyway.
const rs = (n: number) => `Rs ${n.toLocaleString("en-IN")}`;
const safe = (t: string) => t.replace(/₹/g, "Rs ").replace(/[^\x20-\x7E]/g, "");
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const dmy = (d: Date) => { const s = ymd(d); return `${s.slice(8, 10)} ${MONTHS[Number(s.slice(5, 7)) - 1].slice(0, 3)}`; };

export async function statementPdf(merchant_id: string, period: string) {
  if (!/^\d{4}-\d{2}$/.test(period)) throw new Error("period must be YYYY-MM");
  const [y, mo] = period.split("-").map(Number);
  const from = new Date(Date.UTC(y, mo - 1, 1));
  const to = new Date(Date.UTC(y, mo, 0)); // last day of the month (settlement.date is a DATE)
  const m = await db.merchant.findUnique({ where: { id: merchant_id } });
  if (!m) throw new Error("merchant not found");
  const [sets, credits] = await Promise.all([
    db.settlement.findMany({ where: { merchant_id, date: { gte: from, lte: to } }, include: { deductions: true }, orderBy: { date: "asc" } }),
    db.credit.findMany({ where: { merchant_id, created_at: { gte: new Date(+from - IST), lt: new Date(+to + 86_400_000 - IST) } }, orderBy: { created_at: "asc" } }),
  ]);
  const chargeIds = sets.flatMap((s) => s.deductions.map((d) => d.source_ref)).filter((x): x is string => !!x);
  const charges = new Map((await db.charge.findMany({ where: { id: { in: chargeIds } }, select: { id: true, period: true } })).map((c) => [c.id, c.period]));

  const gross = sets.reduce((a, s) => a + s.gross, 0);
  const deducted = sets.reduce((a, s) => a + s.deductions_total, 0);
  const net = sets.reduce((a, s) => a + s.net, 0);
  const refunded = credits.reduce((a, c) => a + c.amount, 0);

  const pdf = await PDFDocument.create();
  pdf.setTitle(`Hisaab statement ${m.business_name} ${period}`);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const W = 595, H = 842, X = 40;
  let page: PDFPage = pdf.addPage([W, H]);
  let yy = H;

  const text = (s: string, x: number, at: number, o: { size?: number; f?: PDFFont; color?: ReturnType<typeof rgb>; right?: boolean } = {}) => {
    const f = o.f ?? font, size = o.size ?? 10, t = safe(s);
    page.drawText(t, { x: o.right ? x - f.widthOfTextAtSize(t, size) : x, y: at, size, font: f, color: o.color ?? INK });
  };
  const newPage = () => { page = pdf.addPage([W, H]); yy = H - 50; };
  const need = (h: number) => { if (yy - h < 60) newPage(); };

  // Header band
  page.drawRectangle({ x: 0, y: H - 70, width: W, height: 70, color: NAVY });
  text("Hisaab", X, H - 38, { size: 20, f: bold, color: rgb(1, 1, 1) });
  text("Paytm Business monthly statement", X, H - 56, { size: 10, color: rgb(0.85, 0.92, 1) });
  text("DEMO DATA", W - X, H - 38, { size: 10, f: bold, color: SKY, right: true });
  yy = H - 100;
  text(m.business_name, X, yy, { size: 16, f: bold });
  text(`${MONTHS[mo - 1]} ${y}`, W - X, yy, { size: 14, f: bold, color: NAVY, right: true });
  yy -= 16;
  text(`${m.owner_name}  |  ${m.city}  |  ${m.id}`, X, yy, { color: MUTED });
  yy -= 30;

  // Summary tiles
  const tiles: [string, string][] = [["Customer payments", rs(gross)], ["Deductions", rs(deducted)], ["Paid to your bank", rs(net)], ["Refunds credited", rs(refunded)]];
  const tw = (W - 2 * X - 3 * 10) / 4;
  tiles.forEach(([k, v], i) => {
    const tx = X + i * (tw + 10);
    page.drawRectangle({ x: tx, y: yy - 46, width: tw, height: 52, color: rgb(0.96, 0.98, 1), borderColor: RULE, borderWidth: 1 });
    text(k, tx + 8, yy - 10, { size: 8, color: MUTED });
    text(v, tx + 8, yy - 32, { size: 13, f: bold, color: i === 2 ? NAVY : INK });
  });
  yy -= 70;
  text(`${sets.length} settlements. Each day's payout is the previous day's UPI payments minus that day's deductions.`, X, yy, { size: 8, color: MUTED });
  yy -= 24;

  // Daily table
  const cols = [X, X + 120, X + 300, W - X];
  const head = () => {
    page.drawRectangle({ x: X, y: yy - 6, width: W - 2 * X, height: 20, color: NAVY });
    text("Date", cols[0] + 6, yy, { size: 9, f: bold, color: rgb(1, 1, 1) });
    text("Customer payments", cols[2] - 6, yy, { size: 9, f: bold, color: rgb(1, 1, 1), right: true });
    text("Deductions", cols[2] + 120, yy, { size: 9, f: bold, color: rgb(1, 1, 1), right: true });
    text("Paid to bank", cols[3] - 6, yy, { size: 9, f: bold, color: rgb(1, 1, 1), right: true });
    yy -= 20;
  };
  text("Daily settlements", X, yy, { size: 12, f: bold });
  yy -= 18;
  head();
  sets.forEach((s, i) => {
    if (yy < 80) { newPage(); head(); }
    if (i % 2) page.drawRectangle({ x: X, y: yy - 5, width: W - 2 * X, height: 16, color: rgb(0.975, 0.98, 0.99) });
    text(dmy(s.date), cols[0] + 6, yy, { size: 9 });
    text(rs(s.gross), cols[2] - 6, yy, { size: 9, right: true });
    text(s.deductions_total ? `- ${rs(s.deductions_total)}` : "-", cols[2] + 120, yy, { size: 9, right: true, color: s.deductions_total ? rgb(0.7, 0.15, 0.15) : MUTED });
    text(rs(s.net), cols[3] - 6, yy, { size: 9, right: true, f: bold });
    yy -= 16;
  });
  page.drawLine({ start: { x: X, y: yy + 10 }, end: { x: W - X, y: yy + 10 }, thickness: 1, color: RULE });
  text("Total", cols[0] + 6, yy - 4, { size: 9, f: bold });
  text(rs(gross), cols[2] - 6, yy - 4, { size: 9, f: bold, right: true });
  text(deducted ? `- ${rs(deducted)}` : "-", cols[2] + 120, yy - 4, { size: 9, f: bold, right: true });
  text(rs(net), cols[3] - 6, yy - 4, { size: 9, f: bold, right: true });
  yy -= 34;

  // Every deduction, explained
  const ded = sets.flatMap((s) => s.deductions.map((d) => ({ d, date: s.date })));
  need(40);
  text("What was deducted, and why", X, yy, { size: 12, f: bold });
  yy -= 18;
  if (!ded.length) { text("No deductions this month.", X, yy, { color: MUTED }); yy -= 16; }
  for (const { d, date } of ded) {
    need(18);
    const forPeriod = d.source_ref && charges.get(d.source_ref) ? ` for ${charges.get(d.source_ref)}` : d.type === "FEE" && !d.source_ref ? " (no linked bill)" : "";
    text(dmy(date), X + 6, yy, { size: 9, color: MUTED });
    text(`${LABEL[d.type] ?? d.type}${forPeriod}`, X + 70, yy, { size: 9 });
    text(`- ${rs(d.amount)}`, W - X - 6, yy, { size: 9, right: true, color: rgb(0.7, 0.15, 0.15) });
    yy -= 15;
  }
  yy -= 12;

  // Refunds
  need(40);
  text("Refunds credited by Hisaab", X, yy, { size: 12, f: bold });
  yy -= 18;
  if (!credits.length) { text("No refunds this month.", X, yy, { color: MUTED }); yy -= 16; }
  for (const c of credits) {
    need(18);
    text(dmy(new Date(+c.created_at + IST)), X + 6, yy, { size: 9, color: MUTED });
    text(c.reason.slice(0, 80), X + 70, yy, { size: 9 });
    text(`+ ${rs(c.amount)}`, W - X - 6, yy, { size: 9, right: true, color: rgb(0.1, 0.5, 0.25) });
    yy -= 15;
  }

  // Footer on every page
  const pages = pdf.getPages();
  pages.forEach((p, i) => {
    p.drawText(safe(`Generated by Hisaab on ${ymd(new Date(Date.now() + IST))}. Amounts in Indian Rupees. Demo data, not a real Paytm statement.  Page ${i + 1}/${pages.length}`), { x: X, y: 28, size: 7, font, color: MUTED });
  });

  const filename = `Hisaab-${m.business_name.replace(/[^A-Za-z0-9]+/g, "-")}-${period}.pdf`;
  return { buf: Buffer.from(await pdf.save()), filename, summary: { period, settlements: sets.length, gross, deducted, net, refunded } };
}
