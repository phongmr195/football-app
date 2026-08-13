import { Badge, Button, Card, Container } from "@football-app/ui";

export default function Home() {
  return (
    <div className="flex flex-1 items-center justify-center bg-zinc-50 dark:bg-black">
      <Container size="sm" className="py-16">
        <Card className="flex flex-col items-start gap-4">
          <Badge variant="info">Phase 1 &middot; Web</Badge>
          <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
            Football App
          </h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            This placeholder page proves that <code>apps/web</code> is wired up to{" "}
            <code>@football-app/ui</code> (Button, Card, Badge, Container). Browse pages
            (competitions, standings, matches, teams, players) land in a later piece.
          </p>
          <Button>Get started</Button>
        </Card>
      </Container>
    </div>
  );
}
