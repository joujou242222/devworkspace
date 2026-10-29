import { defineConfig } from 'prisma/config';
export default defineConfig({
  schema: 'prisma/product/schema.prisma',
  datasource: {
    url:
      process.env.PRODUCT_IDENTITY_URL ??
      'postgresql://unused:unused@127.0.0.1:55432/devworkspace_phase2',
  },
});
