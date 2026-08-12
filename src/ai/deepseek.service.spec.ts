import {
  DeepseekService,
  computeBackoffMs,
  DeepseekDisabledError,
  DeepseekAuthError,
  DeepseekRateLimitError,
} from './deepseek.service';

function mockRes(opts: { ok?: boolean; status?: number; body?: any; retryAfter?: string; text?: string }): any {
  return {
    ok: opts.ok ?? false,
    status: opts.status ?? 200,
    headers: { get: (h: string) => (h.toLowerCase() === 'retry-after' ? opts.retryAfter ?? null : null) },
    json: async () => opts.body,
    text: async () => opts.text ?? '',
  };
}

describe('computeBackoffMs', () => {
  it('honra Retry-After (segundos → ms, con tope)', () => {
    expect(computeBackoffMs(0, 3)).toBe(3000);
    expect(computeBackoffMs(0, 999, 1000, 60000)).toBe(60000); // tope
  });
  it('sin Retry-After crece exponencial dentro del cap', () => {
    const d = computeBackoffMs(3, undefined, 1000, 60000); // exp = 8000 → jitter [4000,8000]
    expect(d).toBeGreaterThanOrEqual(4000);
    expect(d).toBeLessThanOrEqual(8000);
  });
});

describe('DeepseekService.complete', () => {
  const OLD = { ...process.env };
  afterEach(() => {
    process.env = { ...OLD };
    jest.restoreAllMocks();
  });

  it('lanza DeepseekDisabledError sin API key', async () => {
    delete process.env.DEEPSEEK_API_KEY;
    await expect(new DeepseekService().complete([{ role: 'user', content: 'hi' }])).rejects.toBeInstanceOf(
      DeepseekDisabledError,
    );
  });

  it('devuelve el contenido del primer choice (200)', async () => {
    process.env.DEEPSEEK_API_KEY = 'k';
    global.fetch = jest.fn().mockResolvedValue(
      mockRes({ ok: true, status: 200, body: { choices: [{ message: { content: '  prompt ok  ' } }] } }),
    ) as any;
    const out = await new DeepseekService().complete([{ role: 'user', content: 'hi' }]);
    expect(out).toBe('prompt ok');
  });

  it('no reintenta credenciales/saldo (401/402/403)', async () => {
    process.env.DEEPSEEK_API_KEY = 'k';
    global.fetch = jest.fn().mockResolvedValue(mockRes({ status: 402, text: 'no balance' })) as any;
    await expect(new DeepseekService().complete([{ role: 'user', content: 'hi' }])).rejects.toBeInstanceOf(
      DeepseekAuthError,
    );
    expect((global.fetch as jest.Mock).mock.calls.length).toBe(1);
  });

  it('429 con tope de espera 0 → RateLimitError sin dormir', async () => {
    process.env.DEEPSEEK_API_KEY = 'k';
    process.env.DEEPSEEK_MAX_WAIT_MS = '0';
    global.fetch = jest.fn().mockResolvedValue(mockRes({ status: 429, retryAfter: '5' })) as any;
    await expect(new DeepseekService().complete([{ role: 'user', content: 'hi' }])).rejects.toBeInstanceOf(
      DeepseekRateLimitError,
    );
  });
});
