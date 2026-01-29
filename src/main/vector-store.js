/**
 * Vector Store
 * 
 * In-memory vector store for workflow retrieval.
 * Uses cosine similarity for semantic search.
 * 
 * Note: This is a lightweight implementation that stores embeddings in SQLite.
 * For production use with large datasets, consider ChromaDB or similar.
 */

class VectorStore {
    constructor(db, embeddingService) {
        this.db = db;
        this.embeddingService = embeddingService;
        this.cache = new Map(); // In-memory cache of embeddings
    }

    /**
     * Index a workflow with its embedding
     * @param {Object} workflow - Workflow to index
     * @param {string} text - Text to embed for this workflow
     */
    async indexWorkflow(workflow, text) {
        try {
            const embedding = await this.embeddingService.embed(text);
            await this.db.updateWorkflowEmbedding(workflow.id, embedding);
            this.cache.set(workflow.id, embedding);
            console.log(`[VectorStore] Indexed workflow ${workflow.id}`);
        } catch (error) {
            console.error(`[VectorStore] Failed to index workflow ${workflow.id}:`, error.message);
        }
    }

    /**
     * Search for similar workflows by query
     * @param {string} query - Search query
     * @param {number} topK - Number of results to return
     * @returns {Array<Object>} Matching workflows with scores
     */
    async search(query, topK = 5) {
        try {
            // Generate query embedding
            const queryEmbedding = await this.embeddingService.embed(query);

            // Get all workflows with embeddings
            const workflows = await this.db.getWorkflows();
            const results = [];

            for (const workflow of workflows) {
                if (!workflow.embedding) continue;

                let embedding;
                if (this.cache.has(workflow.id)) {
                    embedding = this.cache.get(workflow.id);
                } else {
                    embedding = JSON.parse(workflow.embedding);
                    this.cache.set(workflow.id, embedding);
                }

                const score = this.embeddingService.cosineSimilarity(queryEmbedding, embedding);
                results.push({
                    workflow: {
                        ...workflow,
                        tool_chain: JSON.parse(workflow.tool_chain)
                    },
                    score
                });
            }

            // Sort by score and return top K
            return results
                .sort((a, b) => b.score - a.score)
                .slice(0, topK);
        } catch (error) {
            console.error('[VectorStore] Search failed:', error.message);
            return [];
        }
    }

    /**
     * Reindex all workflows
     */
    async reindexAll() {
        const workflows = await this.db.getWorkflows();
        let indexed = 0;

        for (const workflow of workflows) {
            // Create text representation for embedding
            const text = [
                workflow.name,
                workflow.description,
                workflow.trigger_pattern
            ].filter(Boolean).join(' ');

            try {
                await this.indexWorkflow(workflow, text);
                indexed++;
            } catch (error) {
                console.error(`[VectorStore] Failed to reindex workflow ${workflow.id}:`, error.message);
            }
        }

        console.log(`[VectorStore] Reindexed ${indexed} workflows`);
        return { indexed };
    }

    /**
     * Clear the cache
     */
    clearCache() {
        this.cache.clear();
    }
}

module.exports = VectorStore;
