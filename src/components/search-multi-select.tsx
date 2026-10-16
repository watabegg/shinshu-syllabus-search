import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Popover, PopoverTrigger, PopoverContent, PopoverClose } from '@/components/ui/popover';

type FilterGroup = { name: string; label: string; initialValue: string[]; options: { value: string; label: string }[] };

export function SearchMultiSelect({ label, groups }: { label: string; groups: FilterGroup[] }) {
  const [selected, setSelected] = useState<Record<string, string[]>>(() => Object.fromEntries(groups.map(group => [group.name, group.initialValue])));
  const labels = groups.flatMap(group => group.options.filter(option => selected[group.name].includes(option.value)).map(option => option.label));
  const summary = labels.length === 0 ? 'すべて' : labels.length > 3 ? `${labels.slice(0, 2).join('・')} ほか${labels.length - 2}件` : labels.join('・');
  const id = `filter-${groups[0].name}`;
  return <div className="field">
    <label htmlFor={id}>{label}</label>
    {groups.map(group => <input key={group.name} type="hidden" name={group.name} value={selected[group.name].join(',')} />)}
    <Popover>
      <PopoverTrigger asChild><Button id={id} type="button" variant="outline" className="multi-trigger" aria-label={`${label}を選択`} title={labels.join('・') || 'すべて'}><span>{summary}</span><ChevronDown className="size-4 shrink-0 text-muted-foreground" /></Button></PopoverTrigger>
      <PopoverContent className="multi-select-menu" aria-label={`${label}の選択肢`}>
        <div className="multi-heading"><strong>{label}</strong><Button type="button" variant="ghost" size="xs" onClick={() => setSelected(Object.fromEntries(groups.map(group => [group.name, []])))}>クリア</Button></div>
        {groups.map(group => <fieldset key={group.name} className="multi-group">
          {groups.length > 1 && <legend>{group.label}</legend>}
          {group.options.map(option => <label className="multi-option" key={option.value}>
            <Checkbox checked={selected[group.name].includes(option.value)} onCheckedChange={checked => setSelected(current => ({ ...current, [group.name]: checked === true ? [...current[group.name], option.value] : current[group.name].filter(value => value !== option.value) }))} />
            <span>{option.label}</span>
          </label>)}
        </fieldset>)}
        <div className="multi-footer"><span>複数選択可</span><PopoverClose asChild><Button type="button" size="sm" variant="secondary">完了</Button></PopoverClose></div>
      </PopoverContent>
    </Popover>
  </div>;
}
