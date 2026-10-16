import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {Checkbox, Popover} from 'radix-ui';
import {Check, ChevronDown} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Select,SelectTrigger,SelectValue,SelectContent,SelectItem} from '@/components/ui/select';
import './mock.css';
const groups={'学期':['前期','後期','通年'],'集中授業':['集中','集中以外'],'曜日':['月','火','水','木','金','土','日'],'時限':Array.from({length:10},(_,i)=>`${i+1}限`),'授業形式':['対面','オンデマンド','オンライン（同時配信）','遠隔（方式不明）']};
function App(){
 const [selected,setSelected]=useState<Record<string,string[]>>({'学期':['前期','後期'],'曜日':['月','水'],'時限':['1限','2限']});
 const [summary,setSummary]=useState('');
 const [year,setYear]=useState('2026年度');const [dept,setDept]=useState('すべて');
 const reset=()=>{setSelected({});setSummary('');setDept('すべて');setYear('2026年度')};
 return <div className="site-shell"><header className="site-header"><span className="brand-link"><span className="brand-mark">信</span>シラバス検索</span><p>検索条件のモック</p></header><main className="page-main"><section className="mock-panel"><div className="panel-head"><h1>検索条件</h1><span>各項目は複数選択できます</span></div><form onReset={reset} onSubmit={e=>{e.preventDefault();setSummary(Object.entries(selected).filter(([,v])=>v.length).map(([k,v])=>`${k}：${v.join(' または ')}`).join(' ／ ')||'絞り込みなし')}}>
 <div className="filter-grid">
 {['キーワード','科目名','担当教員','教室'].map((label,i)=><label key={label} className={'field '+(i===0?'field-keyword':'')}>{label}<Input placeholder={['科目名・担当教員・登録コード・本文','科目名を含む','教員名を含む','教室・会場を含む'][i]}/></label>)}
 {[['年度',year,setYear,['2026年度']],['学部・研究科',dept,setDept,['すべて','工学部','人文学部','教育学部']]].map(([label,value,set,options])=><div className="field" key={label as string}><label id={label as string}>{label as string}</label><Select value={value as string} onValueChange={set as (v:string)=>void}><SelectTrigger aria-labelledby={label as string} className="w-full bg-card"><SelectValue/></SelectTrigger><SelectContent>{(options as string[]).map(o=><SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent></Select></div>)}
 </div><div className="compact-filters">
 {['学期','曜日','時限','授業形式'].map(name=>{
 const names=name==='学期'?['学期','集中授業']:[name];
 const values=names.flatMap(n=>(selected[n]||[]));
 const text=values.length===0?'すべて':values.length>3?`${values.slice(0,2).join('・')} ほか${values.length-2}件`:values.join('・');
 return <div className="field" key={name}><span id={`label-${name}`}>{name}</span><Popover.Root><Popover.Trigger asChild><Button type="button" variant="outline" className="multi-trigger" aria-label={`${name}を選択`}><span className={values.length?'has-value':''}>{text}</span><ChevronDown size={16}/></Button></Popover.Trigger><Popover.Portal><Popover.Content aria-label={`${name}の選択肢`} className="multi-popover" sideOffset={6} align="start" collisionPadding={14}>
 <div className="popover-head"><strong>{name}</strong><button type="button" onClick={()=>setSelected(s=>({...s,...Object.fromEntries(names.map(n=>[n,[]]))}))}>クリア</button></div>
 {names.map(group=><fieldset className="popover-group" key={group}>{names.length>1&&<legend>{group==='学期'?'開講学期':'集中授業'}</legend>}{groups[group as keyof typeof groups].map(option=>{const checked=(selected[group]||[]).includes(option);return <label key={option} className="menu-choice"><Checkbox.Root className="check-box" checked={checked} onCheckedChange={v=>setSelected(s=>({...s,[group]:v?[...(s[group]||[]),option]:(s[group]||[]).filter(x=>x!==option)}))}><Checkbox.Indicator><Check size={13} strokeWidth={3}/></Checkbox.Indicator></Checkbox.Root><span>{option}</span></label>})}</fieldset>)}
 <div className="popover-foot"><span>複数選択可</span><Popover.Close asChild><Button type="button" size="sm" variant="secondary">完了</Button></Popover.Close></div>
 </Popover.Content></Popover.Portal></Popover.Root></div>})}
 </div><div className="form-actions"><Button type="submit">検索する</Button><Button type="reset" variant="outline">条件をクリア</Button><span className="hint">未選択の項目は絞り込みません</span></div></form></section>
 <div className="preview" aria-live="polite"><h2>選択した検索条件</h2><p>{summary||'チェックを切り替えて「検索する」で組み合わせを確認できます。'}</p><small>モックのため、実際の検索結果は取得しません。</small></div>
 </main></div>
}createRoot(document.getElementById('root')!).render(<App/>);
