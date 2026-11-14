"use client";

import { useState } from "react";

import { TabButton, Tabs } from "@/components/boards/BoardTabs";
import { DropRows } from "@/components/drops/DropRows";
import { fromOwnCard } from "@/components/drops/drop-card-data";
import { latestPage, pageCount } from "@/components/front/drop-tabs";
import { tabCount, type ProfileTab } from "@/components/profile/profile-tabs";
import { ReceivedRows } from "@/components/profile/ReceivedRows";
import { Empty } from "@/components/site/Empty";
import { Pager } from "@/components/site/Pager";
import type { UserPage } from "@/lib/api";

/**
 * The profile's `drops` and `received`
 * two tabs in the front page's look, `drops` open first on every profile, the count next to
 * each word, 10 rows a page with the front page's page numbers. A tab tap goes back to page 1.
 * The rows and the empty lines are the ones the page had before.
 */
export function ProfileLists({
  drops,
  received,
}: {
  drops: UserPage["drops"];
  received: UserPage["received"];
}) {
  const [tab, setTab] = useState<ProfileTab>("drops");
  const [page, setPage] = useState(1);

  const cards = drops.map(fromOwnCard);
  const items = received.available ? received.items : [];
  const rows = tab === "drops" ? cards.length : items.length;
  const pages = pageCount(rows);

  const pick = (next: ProfileTab) => {
    setTab(next);
    setPage(1);
  };

  return (
    <section className="mt-6 md:mt-8">
      <div className="mb-3">
        <Tabs label="profile lists">
          <TabButton active={tab === "drops"} onClick={() => pick("drops")}>
            drops
            <span className="num ml-1.5 text-chad-accent">{tabCount(cards.length)}</span>
          </TabButton>
          <TabButton active={tab === "received"} onClick={() => pick("received")}>
            received
            {received.available ? (
              <span className="num ml-1.5 text-chad-accent">{tabCount(items.length)}</span>
            ) : null}
          </TabButton>
        </Tabs>
      </div>
      {tab === "drops" ? (
        cards.length === 0 ? (
          <Empty>no drops yet.</Empty>
        ) : (
          <DropRows rows={latestPage(cards, page)} />
        )
      ) : (
        <ReceivedRows
          received={received.available ? { ...received, items: latestPage(items, page) } : received}
        />
      )}
      <Pager pages={pages} page={page} onPick={setPage} />
    </section>
  );
}
