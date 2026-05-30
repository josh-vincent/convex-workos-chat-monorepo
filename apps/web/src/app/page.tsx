import AuthGuard from "@/components/AuthGuard";
import ChatHeader from "@/components/chat/ChatHeader";
import Chat from "@/components/chat/Chat";

export default function Home() {
  return (
    <AuthGuard>
      <main className="flex h-screen flex-col">
        <ChatHeader />
        <Chat />
      </main>
    </AuthGuard>
  );
}
