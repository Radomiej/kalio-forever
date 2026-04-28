/**
 * Test for MAX_ITERATIONS behavior
 * 
 * The current implementation correctly:
 * 1. Emits chat:error with code MAX_ITERATIONS_REACHED
 * 2. Does NOT emit chat:complete (since the turn didn't complete normally)
 * 3. Always emits agent:done
 * 
 * This is correct behavior. The subtle issue is that lastMessageId is not
 * updated before the MAX_ITERATIONS break, but since we emit error instead
 * of complete, it doesn't affect current behavior.
 */

