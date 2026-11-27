import { useProducts } from '@/features/products/product-context';
import { useState } from 'react';
import {
  candidateInput,
  categoryLabels,
  claimTypeLabels,
  verticalLabels,
  type Candidate,
  type CandidateInput,
} from '@guangmo/contracts';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { ChoiceSelect } from '@/components/choice-select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { toast } from 'sonner';
export function CandidateEditor({
  candidate,
  busy,
  onSave,
  onClose,
}: {
  candidate: Candidate;
  busy: boolean;
  onSave: (payload: CandidateInput) => void;
  onClose: () => void;
}) {
  const { products } = useProducts();
  const [sources, setSources] = useState(candidate.sources);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>编辑候选情报</DialogTitle>
          <DialogDescription>核实摘要与依据后再入库。</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            const raw = {
              title: form.get('title'),
              summary: form.get('summary'),
              product: candidate.product,
              market: form.get('market'),
              category: form.get('category'),
              claimType: form.get('claimType'),
              vertical: form.get('vertical') || undefined,
              publishedAt: form.get('publishedAt') || null,
              eventStartsAt: form.get('eventStartsAt') || null,
              eventEndsAt: form.get('eventEndsAt') || null,
              sourceTimes: candidate.sourceTimes?.filter((time) =>
                sources.some((source) => source.url === time.url),
              ),
              language: form.get('language') || null,
              tags: String(form.get('tags'))
                .split(/[,，]/)
                .map((t) => t.trim())
                .filter(Boolean),
              suggestedAction: form.get('suggestedAction'),
              sources,
            };
            const result = candidateInput.safeParse(raw);
            if (!result.success) {
              toast.error(result.error.issues[0]?.message ?? '请检查填写内容');
              return;
            }
            onSave(result.data);
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="candidate-title">标题</Label>
            <Input
              id="candidate-title"
              name="title"
              defaultValue={candidate.title}
              required
              maxLength={200}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="candidate-summary">摘要</Label>
            <Textarea
              id="candidate-summary"
              name="summary"
              defaultValue={candidate.summary}
              required
              minLength={5}
              maxLength={12000}
              rows={5}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>产品</Label>
              <ChoiceSelect
                label="适用产品"
                disabled
                name="product"
                defaultValue={candidate.product}
                options={products.map((p) => ({
                  value: p.id,
                  label: p.name,
                }))}
              />
            </div>
            <div className="space-y-2">
              <Label>市场</Label>
              <ChoiceSelect
                label="适用市场"
                name="market"
                defaultValue={candidate.market}
                options={[
                  { value: 'US', label: '美国' },
                  { value: 'UK', label: '英国' },
                  { value: 'EU', label: '欧洲' },
                  { value: 'Global', label: '全球' },
                ]}
              />
            </div>
            <div className="space-y-2">
              <Label>类型</Label>
              <ChoiceSelect
                label="情报类型"
                name="category"
                defaultValue={candidate.category}
                options={Object.entries(categoryLabels).map(
                  ([value, label]) => ({ value, label }),
                )}
              />
            </div>
            <div className="space-y-2">
              <ChoiceSelect
                label="所属行业"
                name="vertical"
                defaultValue={candidate.vertical}
                options={Object.entries(verticalLabels).map(
                  ([value, label]) => ({ value, label }),
                )}
              />
            </div>
            <div className="space-y-2">
              <Label>信息性质</Label>
              <ChoiceSelect
                label="信息性质"
                name="claimType"
                defaultValue={candidate.claimType}
                options={Object.entries(claimTypeLabels).map(
                  ([value, label]) => ({ value, label }),
                )}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="published-at">来源发布日期 / 时间</Label>
              <Input
                id="published-at"
                name="publishedAt"
                placeholder="2026-11-17 或带时区的 ISO 时间"
                defaultValue={candidate.publishedAt ?? ''}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="event-start">活动开始日期 / 时间</Label>
              <Input
                id="event-start"
                name="eventStartsAt"
                defaultValue={candidate.eventStartsAt ?? ''}
                placeholder="2026-11-20"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="event-end">活动结束日期 / 时间</Label>
              <Input
                id="event-end"
                name="eventEndsAt"
                defaultValue={candidate.eventEndsAt ?? ''}
                placeholder="2026-11-22"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="candidate-language">原文语言</Label>
              <Input
                id="candidate-language"
                name="language"
                defaultValue={candidate.language ?? ''}
                placeholder="未知"
                maxLength={20}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="candidate-tags">标签</Label>
            <Input
              id="candidate-tags"
              name="tags"
              defaultValue={candidate.tags.join('，')}
              placeholder="以逗号分隔"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="candidate-action">建议行动</Label>
            <Textarea
              id="candidate-action"
              name="suggestedAction"
              defaultValue={candidate.suggestedAction}
              maxLength={2000}
            />
          </div>
          <fieldset className="space-y-3">
            <legend className="mb-2 text-sm font-medium">来源与依据</legend>
            {sources.map((source, index) => (
              <div key={index} className="space-y-2 rounded-lg border p-3">
                <Input
                  aria-label={`来源 ${index + 1} 链接`}
                  type="url"
                  value={source.url}
                  readOnly={
                    !candidate.runId &&
                    !candidate.collectionRunId &&
                    index === 0
                  }
                  required
                  onChange={(e) =>
                    setSources(
                      sources.map((v, i) =>
                        i === index ? { ...v, url: e.target.value } : v,
                      ),
                    )
                  }
                />
                <Input
                  aria-label={`来源 ${index + 1} 标题`}
                  value={source.title}
                  maxLength={300}
                  placeholder="来源标题"
                  onChange={(e) =>
                    setSources(
                      sources.map((v, i) =>
                        i === index ? { ...v, title: e.target.value } : v,
                      ),
                    )
                  }
                />
                <Textarea
                  aria-label={`来源 ${index + 1} 依据`}
                  value={source.evidence}
                  required
                  maxLength={2000}
                  onChange={(e) =>
                    setSources(
                      sources.map((v, i) =>
                        i === index ? { ...v, evidence: e.target.value } : v,
                      ),
                    )
                  }
                />
                {sources.length > 1 &&
                  (candidate.runId ||
                    candidate.collectionRunId ||
                    index > 0) && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        setSources(sources.filter((_, i) => i !== index))
                      }
                    >
                      移除来源
                    </Button>
                  )}
              </div>
            ))}
            {sources.length < 10 && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  setSources([...sources, { url: '', title: '', evidence: '' }])
                }
              >
                添加来源
              </Button>
            )}
          </fieldset>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={onClose}
            >
              取消
            </Button>
            <Button disabled={busy}>{busy ? '保存中…' : '保存修改'}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
