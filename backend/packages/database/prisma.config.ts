import { defineConfig } from 'prisma/config';
export default defineConfig({
  schema: 'prisma/experiment/schema.prisma',
  datasource: {
    url: process.env.DATABASE_URL ?? 'postgresql://unused:unused@127.0.0.1:55432/devworkspace_v01',
  },
});
