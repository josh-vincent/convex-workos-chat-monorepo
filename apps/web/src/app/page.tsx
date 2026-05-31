import AuthGuard from "@/components/AuthGuard";
import ChatHeader from "@/components/chat/ChatHeader";
import Chat from "@/components/chat/Chat";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ inspectionId?: string }>;
}) {
  const { inspectionId } = await searchParams;
  return (
    <AuthGuard>
      <main className="flex h-screen flex-col">
        <ChatHeader />
        <Chat inspectionId={inspectionId} />
      </main>
    </AuthGuard>
  );
}
