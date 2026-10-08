import { CheckIcon, ChevronDownIcon } from '@radix-ui/react-icons';
import { useState } from 'react';
import { AppDialog, EmptyState } from '../../../shared/ui';

/** 日期最早可回溯的月数。 */
const MONTHS_BACK = 6;

/** 样板阶段只做展示与勾选，不接入真实站点。 */
const SITE_OPTIONS = ['中国湖南政府采购网', '中国移动采购与招标网', '中国电信阳光采购网'];

const CATEGORY_OPTIONS = ['物业类', '工程类'];

/** 34 个省级行政区。 */
const REGION_OPTIONS = [
  '北京市', '天津市', '河北省', '山西省', '内蒙古自治区',
  '辽宁省', '吉林省', '黑龙江省', '上海市', '江苏省',
  '浙江省', '安徽省', '福建省', '江西省', '山东省',
  '河南省', '湖北省', '湖南省', '广东省', '广西壮族自治区',
  '海南省', '重庆市', '四川省', '贵州省', '云南省',
  '西藏自治区', '陕西省', '甘肃省', '青海省', '宁夏回族自治区',
  '新疆维吾尔自治区', '台湾省', '香港特别行政区', '澳门特别行政区',
];

type PickerKey = 'date' | 'region' | 'site' | 'category';

const PICKER_META: Record<PickerKey, { title: string; description: string }> = {
  date: { title: '选择日期', description: '可选今天及之前的日期，最早回溯半年。' },
  region: { title: '选择地区', description: '可多选；不选择时代表不限地区。' },
  site: { title: '选择网站', description: '可多选；不选择时代表不限网站。' },
  category: { title: '选择类型', description: '可多选；不选择时代表不限类型。' },
};

function pad(value: number) {
  return String(value).padStart(2, '0');
}

function toDateText(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** 以基准日期回溯指定月数，用作日期选择的上下限。 */
function monthsAgo(from: Date, months: number) {
  const target = new Date(from.getTime());
  target.setMonth(target.getMonth() - months);
  return target;
}

function toggleValue(list: string[], value: string) {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

function summarize(values: string[], fallback: string) {
  if (values.length === 0) return fallback;
  if (values.length <= 2) return values.join('、');
  return `${values.slice(0, 2).join('、')} 等 ${values.length} 项`;
}

interface OptionGridProps {
  options: string[];
  selected: string[];
  onToggle: (option: string) => void;
}

function OptionGrid({ options, selected, onToggle }: OptionGridProps) {
  return (
    <div className="bid-opportunity-option-grid">
      {options.map((option) => {
        const isSelected = selected.includes(option);
        return (
          <button
            key={option}
            type="button"
            className={`bid-opportunity-option${isSelected ? ' is-selected' : ''}`}
            aria-pressed={isSelected}
            onClick={() => onToggle(option)}
          >
            <span className="bid-opportunity-option-mark" aria-hidden="true">
              {isSelected ? <CheckIcon /> : null}
            </span>
            <span className="bid-opportunity-option-text">{option}</span>
          </button>
        );
      })}
    </div>
  );
}

function BidOpportunityPage() {
  const [today] = useState(() => new Date());
  const [date, setDate] = useState(() => toDateText(new Date()));
  const [regions, setRegions] = useState<string[]>([]);
  const [sites, setSites] = useState<string[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [openPicker, setOpenPicker] = useState<PickerKey | null>(null);

  const minDate = toDateText(monthsAgo(today, MONTHS_BACK));
  const maxDate = toDateText(today);

  const filters: Array<{ key: PickerKey; label: string; value: string; active: boolean }> = [
    { key: 'date', label: '日期', value: date, active: true },
    { key: 'region', label: '地区', value: summarize(regions, '不限地区'), active: regions.length > 0 },
    { key: 'site', label: '网站', value: summarize(sites, '不限网站'), active: sites.length > 0 },
    { key: 'category', label: '类型', value: summarize(categories, '不限类型'), active: categories.length > 0 },
  ];

  const pickerMeta = openPicker ? PICKER_META[openPicker] : null;
  const clearablePicker = openPicker !== null && openPicker !== 'date';

  const clearCurrentPicker = () => {
    if (openPicker === 'region') setRegions([]);
    if (openPicker === 'site') setSites([]);
    if (openPicker === 'category') setCategories([]);
  };

  return (
    <div className="page-stack bid-opportunity-page">
      <header className="bid-opportunity-head">
        <div>
          <span className="section-kicker">投标机会</span>
          <h2>从公告里筛出值得跟进的机会</h2>
          <p>按日期、地区、网站和类型组合筛选，把精力集中在真正值得投入的标上。</p>
        </div>
        <span className="bid-opportunity-status-pill">界面样板 · 尚未接入数据</span>
      </header>

      <section className="panel bid-opportunity-filter-panel">
        <div className="bid-opportunity-panel-head">
          <div>
            <span className="section-kicker">筛选条件</span>
            <h3>先划定范围</h3>
          </div>
        </div>

        <div className="bid-opportunity-filter-bar">
          {filters.map((item) => (
            <button
              key={item.key}
              type="button"
              className={`bid-opportunity-filter${item.active ? ' is-active' : ''}`}
              aria-haspopup="dialog"
              onClick={() => setOpenPicker(item.key)}
            >
              <span className="bid-opportunity-filter-label">{item.label}</span>
              <span className="bid-opportunity-filter-value">{item.value}</span>
              <ChevronDownIcon className="bid-opportunity-filter-caret" aria-hidden="true" />
            </button>
          ))}
        </div>
      </section>

      <section className="panel bid-opportunity-result-panel">
        <div className="bid-opportunity-panel-head">
          <div>
            <span className="section-kicker">机会列表</span>
            <h3>查询结果</h3>
          </div>
        </div>
        <EmptyState
          title="这里会展示匹配到的招投标公告"
          hint="当前只完成筛选界面，抓取与解析尚未开发；后续将按所选日期、地区、网站和类型汇总公告。"
        />
      </section>

      <AppDialog
        open={openPicker !== null}
        onOpenChange={(open) => { if (!open) setOpenPicker(null); }}
        kicker="筛选条件"
        title={pickerMeta?.title ?? ''}
        description={pickerMeta?.description}
        cardClassName="bid-opportunity-dialog"
        actions={(
          <>
            {clearablePicker ? (
              <button type="button" className="text-button" onClick={clearCurrentPicker}>清空</button>
            ) : null}
            <button type="button" className="secondary-action" onClick={() => setOpenPicker(null)}>完成</button>
          </>
        )}
      >
        {openPicker === 'date' ? (
          <div className="bid-opportunity-date-field">
            <input
              type="date"
              value={date}
              min={minDate}
              max={maxDate}
              aria-label="查询日期"
              onChange={(event) => { if (event.target.value) setDate(event.target.value); }}
            />
            <p>可选范围：{minDate} 至 {maxDate}（今天），最长回溯半年。</p>
          </div>
        ) : null}

        {openPicker === 'region' ? (
          <OptionGrid
            options={REGION_OPTIONS}
            selected={regions}
            onToggle={(option) => setRegions((prev) => toggleValue(prev, option))}
          />
        ) : null}

        {openPicker === 'site' ? (
          <OptionGrid
            options={SITE_OPTIONS}
            selected={sites}
            onToggle={(option) => setSites((prev) => toggleValue(prev, option))}
          />
        ) : null}

        {openPicker === 'category' ? (
          <OptionGrid
            options={CATEGORY_OPTIONS}
            selected={categories}
            onToggle={(option) => setCategories((prev) => toggleValue(prev, option))}
          />
        ) : null}
      </AppDialog>
    </div>
  );
}

export default BidOpportunityPage;
