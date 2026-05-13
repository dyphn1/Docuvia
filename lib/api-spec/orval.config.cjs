const path = require('path');

const root = path.resolve(__dirname, '..', '..');
const apiClientReactSrc = path.resolve(root, 'lib', 'api-client-react', 'src');
const apiZodSrc = path.resolve(root, 'lib', 'api-zod', 'src');
const openapiPath = path.resolve(__dirname, 'openapi.yaml');

const titleTransformer = (config) => {
  config.info ||= {};
  config.info.title = 'Api';
  return config;
};

module.exports = {
  'api-client-react': {
    input: {
      target: openapiPath,
      transformer: titleTransformer,
    },
    output: {
      workspace: apiClientReactSrc,
      target: 'generated',
      client: 'react-query',
      mode: 'split',
      baseUrl: '/api',
      clean: true,
      prettier: true,
      override: {
        fetch: {
          includeHttpResponseReturnType: false,
        },
        mutator: {
          path: path.resolve(apiClientReactSrc, 'custom-fetch.ts'),
          name: 'customFetch',
        },
      },
    },
  },
  zod: {
    input: {
      target: openapiPath,
      transformer: titleTransformer,
    },
    output: {
      workspace: apiZodSrc,
      client: 'zod',
      target: 'generated',
      schemas: { path: 'generated/types', type: 'typescript' },
      mode: 'split',
      clean: true,
      prettier: true,
      override: {
        zod: {
          coerce: {
            query: ['boolean', 'number', 'string'],
            param: ['boolean', 'number', 'string'],
            body: ['bigint', 'date'],
            response: ['bigint', 'date'],
          },
        },
        useDates: true,
        useBigInt: true,
      },
    },
  },
};
