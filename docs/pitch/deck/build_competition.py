import os
S="/tmp/claude-0/-home-user-tocker/2b3bef34-45cf-5fd0-a239-6cda5647963e/scratchpad/"
P="#f4f4f1";SEC="#a3a3a1";T="#818180";HL="rgba(244,244,241,0.12)"
MONO="font-family:'Geist Mono', 'Courier New', monospace"
VB=150
def col(n,cat,names,line,note=None):
    nm="".join(f'<p style="font-size:28px;line-height:1.35;letter-spacing:-0.2px;color:{SEC};white-space:nowrap">{x}</p>' for x in names)
    nt=f'<p style="font-size:20px;line-height:1.4;color:{T};padding:12px 0 0 0;white-space:nowrap">{note}</p>' if note else ''
    return f'''<div style="width:356px;flex:none;display:flex;flex-direction:column;border-top:1px solid {HL};padding:28px 0 37px 0">
<p style="{MONO};font-size:20px;letter-spacing:3px;color:{T}">{n}</p>
<p style="font-size:44px;font-weight:600;letter-spacing:-1.4px;line-height:1.1;color:{P};padding:20px 0 22px 0;white-space:nowrap">{cat}</p>
<div style="display:flex;flex-direction:column">{nm}</div>
<div style="flex:1"></div>
<div style="height:{VB}px;flex:none;border-top:1px solid {HL};padding:22px 0 0 0;display:flex;flex-direction:column"><p style="font-size:34px;font-weight:500;letter-spacing:-0.8px;line-height:1.2;color:{P};white-space:nowrap">{line}</p>{nt}</div>
</div>'''
def row(n,txt,nxt=False,last=False):
    pill=f'<p style="{MONO};font-size:16px;letter-spacing:1.5px;text-transform:uppercase;color:{P};flex:none;padding:5px 10px 4px;border:1px solid rgba(244,244,241,0.5);border-radius:999px">Next</p>' if nxt else ''
    bb=f";border-bottom:1px solid {HL}" if last else ""
    return f'''<div style="display:flex;flex-direction:row;align-items:center;gap:20px;padding:7px 0;border-top:1px solid {HL}{bb}">
<p style="width:36px;flex:none;{MONO};font-size:20px;color:{T};font-variant-numeric:tabular-nums">{n}</p>
<p style="font-size:32px;font-weight:500;letter-spacing:-0.6px;line-height:1.15;color:{P};white-space:nowrap">{txt}</p>{pill}</div>'''
cols = col("01","Chat-to-trade",["Nansen AI","Bankr","Ask Gina"],"You prompt.<br>It executes.","Bankr already has USDC inference.") \
 + col("02","Perps agents",["Senpi","Minara"],"Autonomous.<br>One perps venue.") \
 + col("03","Agent kits",["OpenClaw","Solana Agent Kit"],"Great parts.<br>You wire them.")
tock=f'''<div style="width:548px;flex:none;display:flex;flex-direction:column;border:1px solid rgba(244,244,241,0.5);border-radius:24px;background:rgba(244,244,241,0.05);padding:28px 40px 36px">
<p style="{MONO};font-size:20px;letter-spacing:3px;color:{P}">04</p>
<p style="font-size:44px;font-weight:600;letter-spacing:-1.4px;line-height:1.1;color:{P};padding:20px 0 14px 0">Tocker</p>
<div style="display:flex;flex-direction:column">{row("01","USDC inference",True)}{row("02","x402 alpha")}{row("03","Advanced filters &amp; gates")}{row("04","Social trading")}</div>
<div style="flex:1"></div>
<div style="height:{VB}px;flex:none;border-top:1px solid {HL};padding:22px 0 0 0;display:flex;flex-direction:column"><p style="font-size:34px;font-weight:500;letter-spacing:-0.8px;line-height:1.2;color:{P}">The full stack,<br>hosted 24/7.</p></div>
</div>'''
html=f'''<section id="competition" data-transition="fade" style="background:#000000;color:{P};font-family:'Geist', Arial, sans-serif;padding:128px 128px 160px;display:flex;flex-direction:column;gap:28px">
<p style="{MONO};font-size:24px;letter-spacing:4px;text-transform:uppercase;color:{T}">Competition · agentic trading startups</p>
<h2 style="font-family:'Geist', Arial, sans-serif;font-size:88px;font-weight:600;letter-spacing:-3px;line-height:1.05;color:{P};width:1664px;margin-left:-6px">Three camps. None has the full stack.</h2>
<div style="height:44px;flex:none"></div>
<div style="display:flex;flex-direction:row;justify-content:space-between;align-items:stretch;flex:1;min-height:0">{cols}{tock}</div>
<p style="position:absolute;left:128px;bottom:64px;width:1664px;font-size:22px;line-height:1.35;color:{T};white-space:nowrap">Startups we found, Oct 2026 · Nansen: The Block · Bankr: docs · Gina: askgina.ai · Senpi: Chainwire · Minara: docs · OpenClaw, Solana Agent Kit: GitHub</p>
<aside>Three camps of funded startups are building trading agents. Chat-to-trade apps like Nansen and Bankr wait for your prompt. Perps agents like Senpi are autonomous, but on one venue. Agent kits hand you parts to wire yourself. Tocker is the full stack, hosted 24/7: USDC inference next, x402 alpha, advanced filters, and social trading.</aside>
</section>
'''

open(S+"refine/design/comp-p2.html","w").write(html)
