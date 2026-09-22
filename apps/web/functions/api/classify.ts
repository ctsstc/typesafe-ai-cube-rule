import { createClassifyHandler, type Env } from "../_lib/classify";

const handleClassify = createClassifyHandler();

export const onRequest: PagesFunction<Env> = (context) =>
  handleClassify(context.request, context.env, (promise) => context.waitUntil(promise));
