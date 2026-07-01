import { ReviewTaskList } from "./review/components/ReviewTaskList";
import { ReviewStatsSidebar } from "./review/components/ReviewStatsSidebar";

export default function Review() {
  return (
    <div className="flex h-full animate-in fade-in slide-in-from-bottom-4 duration-500">
      <ReviewTaskList />
      <ReviewStatsSidebar />
    </div>
  );
}
