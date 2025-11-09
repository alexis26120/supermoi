import React, { useEffect, useMemo, useState } from "react"
import { motion } from "framer-motion"
import { Loader2, Rocket, Gavel, Cpu, Timer, Coins, ChevronRight } from "lucide-react"

type Usage = { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }
type Cost = { currency?: string; input?: number; output?: number; total?: number }
type Answer = { name: string; text: string; usage?: Usage; error?: string|null; ms?: number; cost?: Cost }
type Verdict = { winner?: string; scores?: {agent:string; score:number}[]; justification?: string }
type Payload = { question: string; answers: Answer[]; totals: Record<string,{total:number}>; verdict: Verdict }

export default function App() {
  const [q, setQ] = useState("Explique en 1 phrase : quelle est ta spécialité ?")
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<Payload | null>(null)
  const [error, setError] = useState("")
  const API = useMemo(() => import.meta.env.VITE_API_BASE || "", [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key === "Enter") run() }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  async function run() {
    setError("")
    setLoading(true)
    setData(null)
    try {
      const r = await fetch(API + "/debate", { method: "POST", headers: { "Content-Type":"application/json" }, body: JSON.stringify({ question: q }) })
      if(!r.ok) throw new Error("HTTP "+r.status)
      const j = await r.json()
      setData(j)
    } catch (e:any) {
      setError(String(e.message || e))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-black text-zinc-100 px-4 py-6">
      <style>{`.pixel{font-family:"Press Start 2P",system-ui,ui-sans-serif,Arial}`}</style>
      <div className="max-w-6xl mx-auto space-y-6">
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 bg-zinc-900 rounded-2xl flex items-center justify-center shadow-lg shadow-emerald-500/10"><Cpu className="h-5 w-5"/></div>
            <h1 className="pixel text-lg md:text-xl tracking-wide">Super Débat IA</h1>
          </div>
          <div className="hidden md:flex items-center gap-2 text-xs text-zinc-400"><Rocket className="h-4 w-4"/><span>CTRL+ENTER pour lancer</span></div>
        </header>

        <div className="grid md:grid-cols-[1fr_auto] gap-3">
          <textarea value={q} onChange={(e)=>setQ(e.target.value)} className="w-full h-28 md:h-24 bg-zinc-950 border border-zinc-800 rounded-2xl p-4 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/50 shadow-inner shadow-black"/>
          <button onClick={run} disabled={loading} className="h-12 md:h-auto md:min-h-[3.5rem] bg-emerald-600 hover:bg-emerald-500 disabled:bg-zinc-700 text-black font-semibold rounded-2xl px-6 flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/20">
            {loading ? <Loader2 className="h-4 w-4 animate-spin"/> : <ChevronRight className="h-4 w-4"/>}
            <span className="pixel text-[10px]">LANCER</span>
          </button>
        </div>

        {error && (<div className="bg-red-950/50 border border-red-900 rounded-2xl p-4 text-sm">{error}</div>)}
        {!data && !loading && (<div className="text-zinc-400 text-sm">Tape une question puis lance le débat.</div>)}

        {loading && (
          <motion.div initial={{opacity:0}} animate={{opacity:1}} className="bg-zinc-950 border border-zinc-800 rounded-2xl p-6 flex items-center gap-3 text-sm">
            <Loader2 className="h-4 w-4 animate-spin"/><span>Génération…</span>
          </motion.div>
        )}

        {data && (
          <motion.div initial={{opacity:0, y:8}} animate={{opacity:1, y:0}} className="space-y-6">
            <section className="bg-zinc-950 border border-zinc-800 rounded-2xl p-5">
              <div className="pixel text-[10px] uppercase text-zinc-400">Question</div>
              <div className="mt-2 text-sm text-zinc-200">{data.question}</div>
            </section>

            <section className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
              {data.answers?.map((a, i) => (
                <motion.div key={a.name+i} initial={{opacity:0, y:8}} animate={{opacity:1, y:0}} transition={{delay:i*0.05}} className="bg-zinc-950 border border-zinc-800 rounded-2xl p-5 shadow-[0_0_40px_-20px_rgba(16,185,129,0.25)]">
                  <div className="flex items-center justify-between mb-3">
                    <div className="pixel text-[10px] uppercase tracking-wider">{a.name}</div>
                    <div className="flex items-center gap-2 text-[11px] text-zinc-400"><Timer className="h-3.5 w-3.5"/><span>{a.ms ?? 0} ms</span></div>
                  </div>
                  <div className="text-sm leading-relaxed text-zinc-100 break-words">{a.text || ""}</div>
                  <div className="mt-4 grid grid-cols-3 gap-2 text-[11px] text-zinc-400">
                    <div className="bg-black/40 rounded-xl px-3 py-2 border border-zinc-800"><div className="uppercase pixel text-[9px]">Tokens</div><div className="mt-1">{(a.usage?.prompt_tokens||0)+(a.usage?.completion_tokens||0)}</div></div>
                    <div className="bg-black/40 rounded-xl px-3 py-2 border border-zinc-800"><div className="uppercase pixel text-[9px]">Input</div><div className="mt-1">{a.usage?.prompt_tokens||0}</div></div>
                    <div className="bg-black/40 rounded-xl px-3 py-2 border border-zinc-800"><div className="uppercase pixel text-[9px]">Output</div><div className="mt-1">{a.usage?.completion_tokens||0}</div></div>
                  </div>
                  <div className="mt-3 flex items-center justify-between text-[12px]">
                    <div className="flex items-center gap-1 text-emerald-400"><Coins className="h-3.5 w-3.5"/><span>{a.cost?.total?.toFixed ? a.cost.total.toFixed(8) : a.cost?.total} {a.cost?.currency||""}</span></div>
                    {a.error ? <span className="text-red-400">{a.error}</span> : <span className="text-zinc-400">OK</span>}
                  </div>
                </motion.div>
              ))}
            </section>

            <section className="grid md:grid-cols-2 gap-4">
              <div className="bg-zinc-950 border border-zinc-800 rounded-2xl p-5">
                <div className="pixel text-[10px] uppercase text-zinc-400 flex items-center gap-2"><Gavel className="h-4 w-4"/>Verdict</div>
                <div className="mt-3 flex items-center gap-3">
                  <div className="px-3 py-1 rounded-xl bg-emerald-600 text-black pixel text-[10px]">{data.verdict?.winner||""}</div>
                  <div className="text-sm text-zinc-200">{data.verdict?.justification||""}</div>
                </div>
                <div className="mt-3 grid grid-cols-2 md:grid-cols-3 gap-2 text-[12px]">
                  {data.verdict?.scores?.map((s,i)=>(
                    <div key={s.agent+"-"+i} className="bg-black/40 rounded-xl px-3 py-2 border border-zinc-800 flex items-center justify-between"><span className="text-zinc-300">{s.agent}</span><span className="font-semibold">{s.score}</span></div>
                  ))}
                </div>
              </div>
              <div className="bg-zinc-950 border border-zinc-800 rounded-2xl p-5">
                <div className="pixel text-[10px] uppercase text-zinc-400 flex items-center gap-2"><Coins className="h-4 w-4"/>Totaux</div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                  {Object.entries(data.totals || {}).map(([cur,obj])=>(
                    <div key={cur} className="bg-black/40 rounded-xl px-3 py-2 border border-zinc-800 flex items-center justify-between"><span>{cur}</span><span>{Number((obj as any).total).toFixed(8)}</span></div>
                  ))}
                </div>
              </div>
            </section>
          </motion.div>
        )}
      </div>
    </div>
  )
}
