"use client";

import { useEffect } from "react";

/** Give each screen its own tab title ("Howtown | Mago"). The framework resets the title
 *  after navigation, so this keeps it in place for as long as the screen is shown. */
export function useTitle(title: string | null | undefined) {
  useEffect(() => {
    const wanted = title ? `${title} | Mago` : "Mago";
    const apply = () => {
      if (document.title !== wanted) document.title = wanted;
    };
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(document.head, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, [title]);
}
