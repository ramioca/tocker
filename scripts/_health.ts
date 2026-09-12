import { getDb, agents } from "@/db";
(async () => { try { const db = await getDb(); const a = await db.select({ id: agents.id }).from(agents); console.log(`OK agents=${a.length}`); } catch (e) { console.log("BROKEN:", String((e as {cause?:Error}).cause?.message ?? (e as Error).message).slice(0,120)); } process.exit(0); })();
