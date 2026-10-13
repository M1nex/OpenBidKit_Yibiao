import { CheckIcon, ChevronDownIcon, ExternalLinkIcon, ReloadIcon } from '@radix-ui/react-icons';
import * as Popover from '@radix-ui/react-popover';
import { memo, useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { AppDialog, EmptyState, useToast } from '../../../shared/ui';
import type { BidOpportunityNotice, BidOpportunityNoticeDetail, BidOpportunityProgress, BidOpportunityQueryMode, BidOpportunityQueryResult, BidOpportunitySourceId } from '../types';

const MONTHS_BACK = 6;
const SITE_OPTIONS = [
  { id: 'hunan' as const, label: '中国湖南政府采购网' },
  { id: 'mobile' as const, label: '中国移动采购与招标网' },
  { id: 'telecom' as const, label: '中国电信阳光采购网' },
];
const ALL_SOURCE_IDS: BidOpportunitySourceId[] = SITE_OPTIONS.map((source) => source.id);
const RESULT_PAGE_SIZE = 24;
const CATEGORY_OPTIONS = ['物业类', '工程类'];
const REGION_OPTIONS = [
  '北京市', '天津市', '河北省', '山西省', '内蒙古自治区', '辽宁省', '吉林省', '黑龙江省',
  '上海市', '江苏省', '浙江省', '安徽省', '福建省', '江西省', '山东省', '河南省', '湖北省',
  '湖南省', '广东省', '广西壮族自治区', '海南省', '重庆市', '四川省', '贵州省', '云南省',
  '西藏自治区', '陕西省', '甘肃省', '青海省', '宁夏回族自治区', '新疆维吾尔自治区',
  '台湾省', '香港特别行政区', '澳门特别行政区',
];

type PickerKey = 'date' | 'region' | 'site' | 'category';
const PICKER_META: Record<PickerKey, { title: string; description: string }> = {
  date: { title: '选择日期', description: '可选今天及之前的日期，最早回溯半年。' },
  region: { title: '选择地区', description: '可多选；不选择时代表不限地区。' },
  site: { title: '选择网站', description: '可多选；不选择时代表不限网站。' },
  category: { title: '选择类型', description: '可多选；不选择时代表不限类型。' },
};

function pad(value: number) { return String(value).padStart(2, '0'); }
function toDateText(date: Date) { return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`; }
function monthsAgo(from: Date, months: number) { const target = new Date(from.getTime()); target.setMonth(target.getMonth() - months); return target; }
function toggleValue(list: string[], value: string) { return list.includes(value) ? list.filter((item) => item !== value) : [...list, value]; }
function summarize(values: string[], fallback: string) { if (!values.length) return fallback; if (values.length <= 2) return values.join('、'); return `${values.slice(0, 2).join('、')} 等 ${values.length} 项`; }
function stripHtml(html: string) { return html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/\s+/g, ' ').trim(); }
function normalizeRegion(value: string) { return value.replace(/省|市|自治区|特别行政区/g, ''); }
function categoryMatches(notice: BidOpportunityNotice, categories: string[]) {
  if (!categories.length) return true;
  const text = `${notice.title} ${notice.noticeType}`;
  return categories.some((category) => category === '物业类' ? /物业|保洁|绿化|保安|后勤|餐饮服务/.test(text) : /工程|建设|施工|改造|监理|设计|装修|维护/.test(text));
}

interface OptionGridProps { options: string[]; selected: string[]; onToggle: (option: string) => void; }
function OptionGrid({ options, selected, onToggle }: OptionGridProps) {
  return <div className="bid-opportunity-option-grid">{options.map((option) => {
    const isSelected = selected.includes(option);
    return <button key={option} type="button" className={`bid-opportunity-option${isSelected ? ' is-selected' : ''}`} aria-pressed={isSelected} onClick={() => onToggle(option)}>
      <span className="bid-opportunity-option-mark" aria-hidden="true">{isSelected ? <CheckIcon /> : null}</span><span className="bid-opportunity-option-text">{option}</span>
    </button>;
  })}</div>;
}

function sourceLabel(sourceId: BidOpportunitySourceId) { return SITE_OPTIONS.find((source) => source.id === sourceId)?.label || sourceId; }

const NoticeCard = memo(function NoticeCard({ notice, onOpen, onOpenSource }: { notice: BidOpportunityNotice; onOpen: () => void; onOpenSource: () => void }) {
  return <article className="bid-opportunity-notice-card">
    <div className="bid-opportunity-notice-card-head"><div className="bid-opportunity-notice-tags"><span className="bid-opportunity-notice-tag">{sourceLabel(notice.sourceId)}</span><span className="bid-opportunity-notice-tag is-muted">{notice.noticeType}</span></div><span className="bid-opportunity-notice-date">{notice.publishedDate || '日期未知'}</span></div>
    <button type="button" className="bid-opportunity-notice-title" onClick={onOpen}>{notice.title || '未命名公告'}</button>
    <div className="bid-opportunity-notice-meta"><span>{notice.regionLabel || '地区未标注'}</span>{notice.procuringEntity ? <span>{notice.procuringEntity}</span> : null}</div>
    <div className="bid-opportunity-notice-actions"><button type="button" className="text-button" onClick={onOpen}>查看详情</button><button type="button" className="text-button" onClick={onOpenSource}><ExternalLinkIcon /> 打开来源</button></div>
  </article>;
});

interface FilterControlsProps {
  date: string;
  setDate: (value: string) => void;
  regions: string[];
  setRegions: Dispatch<SetStateAction<string[]>>;
  sites: string[];
  setSites: Dispatch<SetStateAction<string[]>>;
  categories: string[];
  setCategories: Dispatch<SetStateAction<string[]>>;
  minDate: string;
  maxDate: string;
  loading: boolean;
  progress: BidOpportunityProgress | null;
  onQuery: () => void;
}

function FilterControls({ date, setDate, regions, setRegions, sites, setSites, categories, setCategories, minDate, maxDate, loading, progress, onQuery }: FilterControlsProps) {
  const [openPicker, setOpenPicker] = useState<PickerKey | null>(null);
  const filters: Array<{ key: PickerKey; label: string; value: string; active: boolean }> = [
    { key: 'date', label: '日期', value: date, active: true },
    { key: 'region', label: '地区', value: summarize(regions, '不限地区'), active: regions.length > 0 },
    { key: 'site', label: '网站', value: summarize(sites, '不限网站'), active: sites.length > 0 },
    { key: 'category', label: '类型', value: summarize(categories, '不限类型'), active: categories.length > 0 },
  ];
  const clearCurrentPicker = () => {
    if (openPicker === 'region') setRegions([]);
    if (openPicker === 'site') setSites([]);
    if (openPicker === 'category') setCategories([]);
  };
  const renderPicker = (key: PickerKey) => <>
    <div className="bid-opportunity-popover-head"><div><span className="section-kicker">筛选条件</span><strong>{PICKER_META[key].title}</strong></div><button type="button" className="text-button" onClick={clearCurrentPicker}>清空</button></div>
    <p className="bid-opportunity-popover-description">{PICKER_META[key].description}</p>
    {key === 'date' ? <div className="bid-opportunity-date-field"><input type="date" value={date} min={minDate} max={maxDate} aria-label="查询日期" onChange={(event) => { if (event.target.value) setDate(event.target.value); }} /><p>可选范围：{minDate} 至 {maxDate}</p></div> : null}
    {key === 'region' ? <OptionGrid options={REGION_OPTIONS} selected={regions} onToggle={(option) => setRegions((prev) => toggleValue(prev, option))} /> : null}
    {key === 'site' ? <OptionGrid options={SITE_OPTIONS.map((source) => source.label)} selected={sites} onToggle={(option) => setSites((prev) => toggleValue(prev, option))} /> : null}
    {key === 'category' ? <OptionGrid options={CATEGORY_OPTIONS} selected={categories} onToggle={(option) => setCategories((prev) => toggleValue(prev, option))} /> : null}
    <div className="bid-opportunity-popover-actions"><Popover.Close asChild><button type="button" className="secondary-action">完成</button></Popover.Close></div>
  </>;

  return <>
    <section className="panel bid-opportunity-filter-panel"><div className="bid-opportunity-panel-head"><div><span className="section-kicker">筛选条件</span><h3>先划定范围</h3></div><button type="button" className="secondary-action bid-opportunity-refresh-button" onClick={onQuery} disabled={loading}><ReloadIcon /> {loading ? '查询中' : '查询'}</button></div>
      <div className="bid-opportunity-filter-bar">{filters.map((item) => <Popover.Root key={item.key} open={openPicker === item.key} onOpenChange={(open) => setOpenPicker(open ? item.key : null)}>
        <Popover.Trigger asChild><button type="button" className={`bid-opportunity-filter${item.active ? ' is-active' : ''}`} aria-haspopup="dialog"><span className="bid-opportunity-filter-label">{item.label}</span><span className="bid-opportunity-filter-value">{item.value}</span><ChevronDownIcon className="bid-opportunity-filter-caret" aria-hidden="true" /></button></Popover.Trigger>
        <Popover.Portal><Popover.Content className="bid-opportunity-popover" side="bottom" align="start" sideOffset={8} collisionPadding={12}>{renderPicker(item.key)}<Popover.Arrow className="bid-opportunity-popover-arrow" /></Popover.Content></Popover.Portal>
      </Popover.Root>)}</div>
      {progress ? <p className="bid-opportunity-progress">{progress.message}（{progress.current}/{progress.total}）</p> : null}
    </section>
  </>;
}

function BidOpportunityPage() {
  const { showToast } = useToast();
  const [date, setDate] = useState(() => toDateText(new Date()));
  const [regions, setRegions] = useState<string[]>([]);
  const [sites, setSites] = useState<string[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [queryDate, setQueryDate] = useState(() => toDateText(new Date()));
  const [querySourceIds, setQuerySourceIds] = useState<BidOpportunitySourceId[]>(ALL_SOURCE_IDS);
  const [result, setResult] = useState<BidOpportunityQueryResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<BidOpportunityProgress | null>(null);
  const [page, setPage] = useState(1);
  const [detail, setDetail] = useState<BidOpportunityNoticeDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const progressFrame = useRef<number | null>(null);
  const latestProgress = useRef<BidOpportunityProgress | null>(null);

  const minDate = toDateText(monthsAgo(new Date(), MONTHS_BACK));
  const maxDate = toDateText(new Date());
  const sourceIds = useMemo(() => (sites.length ? sites : SITE_OPTIONS.map((source) => source.label)).map((label) => SITE_OPTIONS.find((source) => source.label === label)?.id).filter(Boolean) as BidOpportunitySourceId[], [sites]);
  const visibleItems = useMemo(() => (result?.items || []).filter((notice) => (!regions.length || regions.some((region) => normalizeRegion(notice.regionLabel).includes(normalizeRegion(region)))) && categoryMatches(notice, categories)), [categories, regions, result?.items]);

  const handleProgress = useCallback((nextProgress: BidOpportunityProgress) => {
    latestProgress.current = nextProgress;
    if (progressFrame.current !== null) return;
    progressFrame.current = window.requestAnimationFrame(() => {
      progressFrame.current = null;
      setProgress(latestProgress.current);
    });
  }, []);

  const runQuery = useCallback(async (mode: BidOpportunityQueryMode = 'cache-first', targetPage = 1, target = { date: queryDate, sourceIds: querySourceIds }) => {
    if (progressFrame.current !== null) {
      window.cancelAnimationFrame(progressFrame.current);
      progressFrame.current = null;
    }
    latestProgress.current = null;
    setLoading(true); setProgress(null);
    try {
      const next = await window.yibiao.bidOpportunity.query({ date: target.date, sourceIds: target.sourceIds, mode, page: targetPage, pageSize: RESULT_PAGE_SIZE });
      setResult(next);
      setPage(next.page);
      if (next.sources.some((source) => source.status === 'error')) showToast('部分来源查询失败，已保留可用缓存。', 'info');
    } catch (error) { showToast(error instanceof Error ? error.message : '投标机会查询失败', 'error'); }
    finally { setLoading(false); setProgress(null); }
  }, [queryDate, querySourceIds, showToast]);

  useEffect(() => {
    const unsubscribe = window.yibiao.bidOpportunity.onProgress(handleProgress);
    return () => {
      unsubscribe();
      if (progressFrame.current !== null) window.cancelAnimationFrame(progressFrame.current);
    };
  }, [handleProgress]);

  const applyDraftAndQuery = (mode: BidOpportunityQueryMode = 'cache-first', targetPage = 1) => {
    const target = { date, sourceIds };
    setQueryDate(target.date);
    setQuerySourceIds(target.sourceIds);
    void runQuery(mode, targetPage, target);
  };

  const openDetail = async (notice: BidOpportunityNotice) => {
    setDetail({ ...notice, sourceReference: {}, bodyHtml: null, detailError: null }); setDetailLoading(true);
    try { setDetail(await window.yibiao.bidOpportunity.getDetail(notice.id)); }
    catch (error) { showToast(error instanceof Error ? error.message : '公告详情获取失败', 'error'); }
    finally { setDetailLoading(false); }
  };
  const openSource = async (notice: BidOpportunityNotice) => { const response = await window.yibiao.openExternal(notice.sourceUrl); if (!response.success) showToast(response.message || '来源页面打开失败', 'error'); };

  return <div className="page-stack bid-opportunity-page">
    <header className="bid-opportunity-head"><div><span className="section-kicker">投标机会</span><h2>从公告里筛出值得跟进的机会</h2><p>按日期、地区、网站和类型组合筛选，把精力集中在真正值得投入的标上。</p></div><span className={`bid-opportunity-status-pill${loading ? ' is-loading' : ' is-ready'}`}>{loading ? '正在查询' : '已接入实时数据'}</span></header>
    <FilterControls date={date} setDate={setDate} regions={regions} setRegions={setRegions} sites={sites} setSites={setSites} categories={categories} setCategories={setCategories} minDate={minDate} maxDate={maxDate} loading={loading} progress={progress} onQuery={() => applyDraftAndQuery('refresh')} />
    <section className="panel bid-opportunity-result-panel"><div className="bid-opportunity-panel-head"><div><span className="section-kicker">机会列表</span><h3>查询结果 <span className="bid-opportunity-result-count">{visibleItems.length}</span></h3></div>{result ? <span className="bid-opportunity-result-updated">查询日期 {result.date}</span> : null}</div>
      {loading && !result ? <div className="bid-opportunity-loading">正在从招标网站读取公告…</div> : visibleItems.length ? <div className="bid-opportunity-notice-list">{visibleItems.map((notice) => <NoticeCard key={notice.id} notice={notice} onOpen={() => void openDetail(notice)} onOpenSource={() => void openSource(notice)} />)}</div> : <EmptyState title={result ? '没有匹配的公告' : '等待查询'} hint={result ? '可以更换日期、网站或筛选条件后重新查询。' : '选择筛选条件后点击“查询”开始读取公告。'} />}
      {result && result.total > result.pageSize ? <div className="bid-opportunity-pagination"><button type="button" className="text-button" disabled={page <= 1 || loading} onClick={() => applyDraftAndQuery('cache-first', page - 1)}>上一页</button><span>第 {page} 页，共 {Math.ceil(result.total / result.pageSize)} 页</span><button type="button" className="text-button" disabled={page * result.pageSize >= result.total || loading} onClick={() => applyDraftAndQuery('cache-first', page + 1)}>下一页</button></div> : null}
    </section>
    <AppDialog open={Boolean(detail)} onOpenChange={(open) => { if (!open) setDetail(null); }} kicker="公告详情" title={detail?.title || ''} description={detail ? `${sourceLabel(detail.sourceId)} · ${detail.publishedDate || '日期未知'}` : undefined} cardClassName="bid-opportunity-detail-dialog" actions={<>{detail ? <button type="button" className="text-button" onClick={() => void openSource(detail)}>打开来源</button> : null}<button type="button" className="secondary-action" onClick={() => setDetail(null)}>关闭</button></>}>
      {detailLoading ? <div className="bid-opportunity-loading">正在读取公告正文…</div> : <div className="bid-opportunity-detail-body">{detail?.bodyHtml ? stripHtml(detail.bodyHtml) : '该公告暂未返回正文。'}</div>}
    </AppDialog>
  </div>;
}

export default BidOpportunityPage;
