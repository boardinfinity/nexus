import { Link } from "wouter";

export default function JobCollection() {
  return (
    <div className="p-8">
      <Link href="/pipelines">
        <a className="text-sm text-blue-600 hover:underline">← Back to Pipelines</a>
      </Link>
      <h1 className="text-2xl font-bold mt-4">Job Collection</h1>
      <p className="text-gray-500 mt-2">If you can see this, the route works. The rich forms will be added next.</p>
    </div>
  );
}
