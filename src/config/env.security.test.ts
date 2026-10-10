describe('mobile env secret guard', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = {...originalEnv};
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.JWT_SECRET;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('refuses service secrets in the React Native bundle', () => {
    jest.doMock('react-native-config', () => ({
      __esModule: true,
      default: {
        API_BASE_URL: 'https://example.com',
        OPENAI_API_KEY: 'sk-test-secret',
        ANTHROPIC_API_KEY: 'sk-other-secret',
      },
    }));

    expect(() => require('./env')).toThrow(/secret|bundle/i);
  });
});
