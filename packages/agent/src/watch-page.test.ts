import { it, expect } from 'vitest';
import { watchPageText } from './watch-page.js';
it('extracts readable evidence and removes navigation, scripts and styles', () => {
  const text = watchPageText(
    '<body><nav>navigation</nav><main><h1>Pricing</h1><p>Starter subscription costs 10 dollars a month.</p><p>Professional subscription costs 20 dollars.</p><script>malicious</script><style>hidden</style></main><footer>footer</footer></body>',
  );
  expect(text).toContain('Starter subscription');
  expect(text).toContain('\n');
  for (const ignored of ['navigation', 'malicious', 'hidden', 'footer'])
    expect(text).not.toContain(ignored);
});
it('rejects unavailable text and anti-bot challenges', () => {
  expect(() => watchPageText('<body>Please login</body>')).toThrow();
  expect(() =>
    watchPageText(
      '<body>Just a moment please verify you are human before continuing to this page.</body>',
    ),
  ).toThrow();
});
