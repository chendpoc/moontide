export const DEFAULT_PORT = 8080;
export const load = () => Number(process.env.PORT ?? DEFAULT_PORT);
