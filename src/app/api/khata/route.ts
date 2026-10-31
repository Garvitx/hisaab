import { NextResponse } from "next/server";
import { confirm, editDraft, respond } from "@/khata/entries";
import { sendReminder } from "@/khata/settle";
import { tapSigOk } from "@/khata/tap";

const bad = (status: number, error: string) => NextResponse.json({ error }, { status });

// Khata writes. Draft ops (confirm / edit / delete / choose) come from the tap page and need its
// signature; answering a request and sending a reminder come from /m/[mid], which has no auth
// like the rest of the merchant page (CLAUDE.md rule 6).
export async function POST(req: Request) {
  const b = await req.json().catch(() => null);
  if (!b || typeof b.mid !== "string" || typeof b.op !== "string") return bad(400, "Bad request.");
  const signed = tapSigOk(b.mid, b.sig);
  try {
    switch (b.op) {
      case "confirm":
        if (!signed) return bad(401, "Ye sticker valid nahi hai.");
        return NextResponse.json(await confirm(b.mid, Array.isArray(b.ids) ? b.ids.filter((x: unknown) => typeof x === "string") : undefined));
      case "edit":
        if (!signed) return bad(401, "Ye sticker valid nahi hai.");
        if (typeof b.id !== "string") return bad(400, "Bad request.");
        await editDraft(b.mid, b.id, { amount: b.amount, delete: b.delete === true, choice: b.choice });
        return NextResponse.json({ ok: true });
      case "respond":
        return NextResponse.json(await respond(b.mid, b.accept === true, typeof b.id === "string" ? b.id : undefined));
      case "remind":
        if (typeof b.key !== "string") return bad(400, "Bad request.");
        return NextResponse.json(await sendReminder(b.mid, b.key));
    }
    return bad(400, "Unknown op.");
  } catch (e) {
    // Expected refusals (not a draft any more, already answered) read fine as they are.
    return bad(409, (e as Error)?.message || "Nahi ho paaya.");
  }
}
