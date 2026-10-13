export type BidOpportunitySourceId = 'hunan' | 'mobile' | 'telecom';
export type BidOpportunityQueryMode = 'cache-first' | 'refresh' | 'cache-only';

export interface BidOpportunitySource {
  id: BidOpportunitySourceId;
  name: string;
  baseUrl: string;
}

export interface BidOpportunityNotice {
  id: string;
  sourceId: BidOpportunitySourceId;
  sourceNoticeId: string;
  noticeType: string;
  rawNoticeType: string;
  title: string;
  publishedAt: string | null;
  publishedDate: string | null;
  regionLabel: string;
  regionBasis: string;
  procuringEntity: string;
  sourceUrl: string;
  updatedAt: string;
  detailFetchedAt: string | null;
}

export interface BidOpportunitySourceState {
  sourceId: BidOpportunitySourceId;
  name: string;
  queryKey: string;
  date: string;
  keyword: string;
  status: 'success' | 'error' | 'unqueried';
  complete: boolean;
  fromCache: boolean;
  remoteTotal: number | null;
  lastCheckedAt: string | null;
  lastSuccessAt: string | null;
  error: string | null;
  warning: string | null;
}

export interface BidOpportunityQueryRequest {
  date: string;
  sourceIds?: BidOpportunitySourceId[];
  keyword?: string;
  mode?: BidOpportunityQueryMode;
  page?: number;
  pageSize?: number;
}

export interface BidOpportunityQueryResult {
  items: BidOpportunityNotice[];
  total: number;
  page: number;
  pageSize: number;
  date: string;
  keyword: string;
  sourceIds: BidOpportunitySourceId[];
  mode: BidOpportunityQueryMode;
  sources: BidOpportunitySourceState[];
}

export interface BidOpportunityNoticeDetail extends BidOpportunityNotice {
  sourceReference: Record<string, unknown>;
  bodyHtml: string | null;
  detailError: string | null;
}

export interface BidOpportunityProgress {
  sourceId: BidOpportunitySourceId;
  current: number;
  total: number;
  message: string;
}
