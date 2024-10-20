import type { Context, Next } from "hono";
import { Redis } from "@upstash/redis";

export const cacher = (redis: Redis, seconds: number): (c: Context, next: Next) => Promise<void | Response> => {
  return async (c: Context, next: Next) => {
    // Get cached response from Redis
    const cache = await redis.get(c.req.url);
    if (cache) {
      try {
        // Parse the cached response
        const cachedResponse: {
          body: string;
          headers: Record<string, string>;
          status: number;
        } = cache as {
          body: string;
          headers: Record<string, string>;
          status: number;
        };

        cachedResponse.headers["X-Redis-Cache"] = "HIT";

        // Create a new Response object with the cached data
        const response = new Response(cachedResponse.body, {
          status: cachedResponse.status,
          headers: new Headers(cachedResponse.headers),
        });
        return response;
      } catch (e) {
        console.error("Failed to parse cache:", e);
        return await next();
      }
    } else {
      await next();
      // If the response is not 200, do not cache it
      if (c.res.status !== 200) {
        return;
      }
      c.header("Cache-Control", `public, max-age=${seconds}`);

      // Clone the response so the body can be read without consuming the stream
      const originalResponse = c.res.clone();

      // Read the response body as text
      const responseBody = await originalResponse.text();

      // Create a cache object
      const cacheResponse: {
        body: string;
        headers: Record<string, string>;
        status: number;
      } = {
        body: responseBody,
        headers: {},
        status: originalResponse.status,
      };

      // Extract headers using forEach
      originalResponse.headers.forEach((value, key) => {
        cacheResponse.headers[key] = value;
      });

      // Store the response in Redis
      await redis.set(c.req.url, cacheResponse, { ex: seconds });

      c.res.headers.set("X-Redis-Cache", "MISS");
    }
  };
};
