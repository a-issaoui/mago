import { toast } from "sonner";

/** Run an action and tell the user how it went. Every button that changes something goes
 *  through here, so a failure is never silent. Returns undefined when it failed. */
export async function act<T>(run: () => Promise<T>, done?: string | ((result: T) => string)): Promise<T | undefined> {
  try {
    const result = await run();
    if (done) toast.success(typeof done === "function" ? done(result) : done);
    return result;
  } catch (error) {
    toast.error(error instanceof Error ? error.message : "Something went wrong.");
    return undefined;
  }
}
