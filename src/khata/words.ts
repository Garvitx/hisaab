// Pure text helpers for the khata: Hindi number words and counterparty matching. No DB, no LLM,
// so scripts/check-khata.ts can test them directly.

// Romanised Hindi is spelt many ways (chaalees / chalis, pachchees / pachis): fold doubled letters
// and long vowels before comparing.
const fold = (w: string) => w.toLowerCase().replace(/ee/g, "i").replace(/oo/g, "u").replace(/w/g, "v").replace(/(.)\1+/g, "$1");

// 1..99, in order. Several spellings per number where they differ after folding.
const ONES = `ek|do|teen|chaar,char|paanch,panch|chhah,chhe,chah,chhai|saat|aath|nau|das,dus|gyarah,gyara,gyaarah|barah,baarah,bara|terah,tera|chaudah,chauda|pandrah,pandra|solah,sola|satrah,satra|atharah,athara|unnis,unees|bees,bis|ikkees,ikkis|baais,bais|teis|chaubees,chaubis|pachchees,pachis,pachees|chhabbees,chabbis|sattaais,sattais|atthaais,athais|untees,untis|tees,tis|iktees,iktis|battees,battis|taintees,tetis|chauntees,chautis|paintees,pentis|chhattees,chattis|saintees,sentis|adtees,artis|untaalees,untalis|chaalees,chalis|iktaalees,iktalis|bayaalees,bayalis|taintaalees,tetalis|chavaalees,chavalis,chauvalis|paintaalees,pentalis|chhiyaalees,chiyalis|saintaalees,sentalis|adtaalees,artalis|unchaas|pachaas,pachas|ikyaavan,ikyavan|baavan,bavan|tirpan|chauvan|pachpan|chhappan,chapan|sattaavan,satavan|atthaavan,athavan|unsath|saath,sath|iksath|baasath,basath|tirsath|chausath|painsath,pensath|chhiyaasath,chiyasath|sadsath,sarsath|adsath,arsath|unhattar|sattar|ikhattar|bahattar|tihattar|chauhattar|pachhattar,pachattar|chhihattar,chihattar|sathattar,sathatar|athhattar,athattar|unaasi,unasi|assi,asi|ikyaasi,ikyasi|bayaasi,bayasi|tiraasi,tirasi|chauraasi,chaurasi|pachaasi,pachasi|chhiyaasi,chiyasi|sattaasi,satasi|athaasi,athasi|navaasi,navasi|nabbe,nabe|ikyaanave,ikyanve|baanave,banve|tiraanave,tiranve|chauraanave,chauranve|pachaanave,pachanve|chhiyaanave,chiyanve|sattaanave,sattanve|atthaanave,athanve|ninyaanave,ninyanve`;
const NUM = new Map<string, number>();
ONES.split("|").forEach((alts, i) => alts.split(",").forEach((a) => !NUM.has(fold(a)) && NUM.set(fold(a), i + 1)));
const FRACTION = new Map([["dedh", 1.5], ["derh", 1.5], ["dhai", 2.5], ["adhai", 2.5], ["dhaai", 2.5]].map(([k, v]) => [fold(k as string), v as number]));
const MODIFIER = new Map([["saade", 0.5], ["sade", 0.5], ["saadhe", 0.5], ["sava", 0.25], ["savaa", 0.25], ["sawa", 0.25], ["paune", -0.25], ["pone", -0.25]].map(([k, v]) => [fold(k as string), v as number]));
const MULT = new Map([["sau", 100], ["so", 100], ["hazaar", 1000], ["hazar", 1000], ["hajaar", 1000], ["hajar", 1000], ["thousand", 1000], ["k", 1000], ["hundred", 100], ["lakh", 100000], ["lac", 100000], ["laakh", 100000]].map(([k, v]) => [fold(k as string), v as number]));
// Small words that are also ordinary words ("do" = give, "ek" = a, "nau" = nine/new): a number only next to a multiplier.
const SHY = new Set(["do", "ek", "nau", "sath", "so"].map(fold));

type Tok = { n?: number; frac?: number; mod?: number; mult?: number; digit?: boolean; shy?: boolean };
function tok(raw: string): Tok | null {
  const w = raw.replace(/[₹,]/g, "");
  if (/^\d+(\.\d+)?$/.test(w)) return { n: Number(w), digit: true };
  const f = fold(w);
  if (MULT.has(f)) return { mult: MULT.get(f)! };
  if (FRACTION.has(f)) return { frac: FRACTION.get(f)! };
  if (MODIFIER.has(f)) return { mod: MODIFIER.get(f)! };
  if (NUM.has(f)) return { n: NUM.get(f)!, shy: SHY.has(f) };
  return null;
}

// Whole rupees said in a span: "paanch sau" 500, "dedh hazaar" 1500, "saade teen hazaar" 3500,
// "3,400" / "3.5k" / "teen sau pachaas" as written. null when there is no amount or more than one.
// A phone number said next to an amount ("Priya 98765 43210 ko 300") must never read as rupees:
// Indian mobiles (5+5, 3+3+4 or 10 straight, optional +91) and any 9+ digit run are dropped first.
const PHONE = /(?:\+?91[\s-]?)?\b(?:[6-9]\d{9}|[6-9]\d{4}[\s-]\d{5}|[6-9]\d{2}[\s-]\d{3}[\s-]\d{4})\b|\d{9,}/g;

export function parseAmount(text: string): number | null {
  const words = text.toLowerCase().replace(PHONE, " phone ").replace(/(\d)\s*k\b/g, "$1 k").replace(/(\d)(rs|rupaye|rupees)\b/g, "$1 $2").split(/[^\p{L}\p{N}₹.,]+/u).map((w) => w.replace(/^[.,]+|[.,]+$/g, "")).filter(Boolean);
  const groups: Tok[][] = [];
  let cur: Tok[] = [];
  for (const w of words) {
    const t = tok(w);
    // "500 300" is two amounts, not 800: a digit right after a number starts a new group.
    if (t?.digit && cur.length && cur.at(-1)!.mult == null && cur.at(-1)!.mod == null) (groups.push(cur), (cur = [t]));
    else if (t) cur.push(t);
    else if (cur.length) (groups.push(cur), (cur = []));
  }
  if (cur.length) groups.push(cur);
  // A lone "do" / "ek" is a verb or an article, not an amount.
  const real = groups.filter((g) => !(g.length === 1 && g[0].shy) && g.some((t) => t.n != null || t.frac != null));
  if (real.length !== 1) return null;
  let total = 0, part = 0, mod = 0;
  for (const t of real[0]) {
    if (t.mod != null) mod = t.mod;
    else if (t.n != null || t.frac != null) (part += (t.n ?? t.frac!) + mod), (mod = 0);
    else if (t.mult === 100) part = (part || 1) * 100;
    else if (t.mult) (total += (part || 1) * t.mult), (part = 0);
  }
  const v = total + part;
  return Number.isInteger(v) && v > 0 ? v : null;
}

// ---- counterparties ----

// Words that say how someone is referred to, not who: "Gupta wale ko", "Priya ji se".
const PARTICLE = new Set(["ko", "se", "ka", "ki", "ke", "ne", "wale", "wala", "waale", "waala", "vale", "vala", "wali", "ji", "bhai", "bhaiya", "bhaiyya", "uncle", "aunty", "auntie", "sahab", "saab", "sir", "madam", "didi", "dukaan", "dukan", "shop", "the", "mr", "mrs", "shri", "shrimati"]);
// Shop-type words: on their own they don't identify a merchant ("sweets wale" could be three shops).
const GENERIC = new Set(["store", "stores", "general", "kirana", "sweets", "sweet", "medical", "hall", "corner", "mobile", "centre", "center", "dhaba", "unisex", "salon", "stationers", "stationery", "chemist", "mishthan", "bhandar", "provision", "point", "restaurant", "studio", "medicos", "book", "depot", "dairy", "world", "family", "hair", "beauty", "life", "care", "pharmacy", "bhojnalaya", "telecom", "fresh", "mart", "and", "route", "spice", "tadka", "looks", "style", "glamour", "wellness", "plus"]);

export const nameTokens = (s: string) =>
  s.toLowerCase().replace(/&/g, " ").split(/[^\p{L}\p{N}]+/u).filter((w) => w && !PARTICLE.has(w));

function close(a: string, b: string) {
  if (a === b) return true;
  if (Math.min(a.length, b.length) < 5 || Math.abs(a.length - b.length) > 1) return false;
  if (fold(a) === fold(b)) return true; // "aggarwal" / "agarwal"
  // edit distance <= 1: "bansl" / "bansal"
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) (i++, j++);
    else {
      if (++edits > 1) return false;
      if (a.length > b.length) i++;
      else if (b.length > a.length) j++;
      else (i++, j++);
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

export type Shop = { id: string; business_name: string };
export type Resolved =
  | { type: "MERCHANT"; mid: string; name: string }
  | { type: "CUSTOMER"; name: string }
  | { type: "AMBIGUOUS"; name: string; choices: ({ type: "MERCHANT"; mid: string; name: string } | { type: "CUSTOMER"; name: string })[] };

// Who "Gupta wale" / "Priya" is, in code (never the model): a merchant by business name, else a
// customer already in this khata, else a new customer. Two equally good answers come back AMBIGUOUS.
// ponytail: token overlap plus one-edit fuzz; good for 30 shops, use trigram search if the network grows.
export function resolveCounterparty(said: string, shops: Shop[], customers: string[], selfMid?: string): Resolved | null {
  const t = nameTokens(said);
  if (!t.length) return null;
  const display = said.trim().replace(/\s+(ko|se|ka|ki|ke|ne)$/i, "").replace(/\s+(wale|wala|waale|waala|ji)$/i, "").trim() || said.trim();

  const scored = shops
    .filter((s) => s.id !== selfMid)
    .map((s) => {
      const b = nameTokens(s.business_name);
      const hits = t.filter((w) => b.some((x) => close(w, x)));
      const distinct = hits.some((w) => b.some((x) => close(w, x) && !GENERIC.has(x)));
      return { s, hits: hits.length, distinct, all: b.every((x) => t.some((w) => close(w, x))) };
    });
  // A distinctive word ("Gupta", "Ganesh") names a shop; shop-type words alone only narrow it down.
  let shopHits = scored.filter((x) => x.distinct);
  const exact = shopHits.filter((x) => x.all);
  if (exact.length === 1) shopHits = exact;
  const best = Math.max(0, ...shopHits.map((x) => x.hits));
  shopHits = shopHits.filter((x) => x.hits === best);
  const generic = shopHits.length ? [] : scored.filter((x) => x.hits > 0 && t.every((w) => GENERIC.has(w)));

  const cust = customers.filter((c) => {
    const ct = nameTokens(c);
    return t.every((w) => ct.some((x) => close(w, x))); // "Priya" finds "Priya Sharma", "Priya Verma" doesn't
  });
  const exactCust = cust.filter((c) => nameTokens(c).join(" ") === t.join(" "));
  const custHits = exactCust.length ? exactCust : cust;

  const shopChoices = (shopHits.length ? shopHits : generic).map((x) => ({ type: "MERCHANT" as const, mid: x.s.id, name: x.s.business_name }));
  const custChoices = [...new Set(custHits)].map((name) => ({ type: "CUSTOMER" as const, name }));
  const choices = [...shopChoices, ...custChoices];
  if (choices.length === 1) return choices[0];
  if (choices.length > 1) return { type: "AMBIGUOUS", name: display, choices: choices.slice(0, 4) };
  return { type: "CUSTOMER", name: display.replace(/\b\p{Ll}/gu, (c) => c.toUpperCase()) };
}
