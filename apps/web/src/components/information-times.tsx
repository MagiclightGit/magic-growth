import type { CandidateInput, SourceTime } from '@guangmo/contracts';

export function informationDateLabel(value: string) {
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    ...(dateOnly
      ? { timeZone: 'UTC' }
      : { hour: '2-digit', minute: '2-digit', timeZoneName: 'short' }),
  }).format(new Date(value));
}
type TimeFields = Pick<
  CandidateInput,
  'publishedAt' | 'eventStartsAt' | 'eventEndsAt' | 'sourceTimes'
>;
export function InformationTimes({
  value,
  collectedAt,
  primaryUrl,
}: {
  value: TimeFields;
  collectedAt: string;
  primaryUrl: string;
}) {
  const primary = value.sourceTimes?.find(
    (source) => source.url === primaryUrl,
  );
  return (
    <div className="space-y-1 text-xs text-muted-foreground">
      {value.eventStartsAt && (
        <p className="font-medium text-foreground">
          活动：{informationDateLabel(value.eventStartsAt)}
          {value.eventEndsAt &&
            value.eventEndsAt !== value.eventStartsAt &&
            ` — ${informationDateLabel(value.eventEndsAt)}`}
        </p>
      )}
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {value.publishedAt ? (
          <span>来源发布：{informationDateLabel(value.publishedAt)}</span>
        ) : !value.eventStartsAt ? (
          <span>未取得来源发布日期</span>
        ) : null}
        {primary?.modifiedAt && (
          <span>来源更新：{informationDateLabel(primary.modifiedAt)}</span>
        )}
        <span>收集于：{informationDateLabel(collectedAt)}</span>
      </div>
    </div>
  );
}
export function SourceTimeDetails({ value }: { value?: SourceTime }) {
  if (!value) return null;
  return (
    <div className="mt-2 space-y-1 text-xs text-muted-foreground">
      {value.publishedAt && (
        <p>页面首次发布：{informationDateLabel(value.publishedAt)}</p>
      )}
      {!value.publishedAt && <p>未取得页面发布日期</p>}
      {value.modifiedAt && (
        <p>页面最后更新：{informationDateLabel(value.modifiedAt)}</p>
      )}
      <p>
        来源核查：{informationDateLabel(value.fetchedAt)}
        {value.status === 'unavailable' ? ' · 时间元数据未获取' : ''}
      </p>
    </div>
  );
}
