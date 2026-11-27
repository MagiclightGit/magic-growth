import { Streamdown } from 'streamdown';
import { cjk } from '@streamdown/cjk';

export function ResearchReport({
  children,
  streaming = false,
}: {
  children: string;
  streaming?: boolean;
}) {
  return (
    <Streamdown
      className="min-w-0 break-words text-sm leading-7"
      mode={streaming ? 'streaming' : 'static'}
      isAnimating={streaming}
      plugins={{ cjk }}
      skipHtml
      controls={false}
      linkSafety={{ enabled: false }}
    >
      {children}
    </Streamdown>
  );
}
