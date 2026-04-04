import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";

export function createAgentTools() {
  const webSearchTool = new DynamicStructuredTool({
    name: "web_search",
    description:
      "Search the web for short factual context using public online sources. Use this when a joke would benefit from timely or factual background.",
    schema: z.object({
      query: z.string().min(2).max(120),
    }),
    func: async ({ query }) => {
      const url = `/api/web-search?q=${encodeURIComponent(query)}`;
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Web search failed with status ${response.status}`);
      }

      const payload = await response.json();
      if (!payload.results?.length) {
        return `No relevant results found for: ${query}`;
      }

      return payload.results
        .map((result, index) => {
          const title = result.title || "Untitled";
          const snippet = result.snippet || "No summary available.";
          return `${index + 1}. ${title}: ${snippet}`;
        })
        .join("\n");
    },
  });

  return [webSearchTool];
}

export function describeTools(tools) {
  return tools
    .map((tool) => `- ${tool.name}: ${tool.description}`)
    .join("\n");
}

export function buildToolMap(tools) {
  return new Map(tools.map((tool) => [tool.name, tool]));
}
