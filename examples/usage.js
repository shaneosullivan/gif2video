/**
 * Example: Using gif2vid programmatically
 */

import gif2vid from '../lib/index.js';

async function examples() {
  console.log('gif2vid - Usage Examples\n');

  // Example 1: Basic conversion with explicit output file
  console.log('Example 1: Convert GIF to specific MP4 file');
  try {
    const output = await gif2vid('./input.gif', './output.mp4');
    console.log(`✓ Created: ${output}\n`);
  } catch (error) {
    console.log(`✗ Error: ${error.message}\n`);
  }

  // Example 2: Output to directory (auto-generates filename)
  console.log('Example 2: Convert GIF to directory');
  try {
    const output = await gif2vid('./input.gif', './videos/');
    console.log(`✓ Created: ${output}\n`);
  } catch (error) {
    console.log(`✗ Error: ${error.message}\n`);
  }

  // Example 3: Output path without extension (adds .mp4)
  console.log('Example 3: Convert GIF with path without extension');
  try {
    const output = await gif2vid('./input.gif', './output');
    console.log(`✓ Created: ${output}\n`);
  } catch (error) {
    console.log(`✗ Error: ${error.message}\n`);
  }

  // Example 4: Custom FPS
  console.log('Example 4: Convert GIF with custom FPS');
  try {
    const output = await gif2vid('./input.gif', './output-30fps.mp4', {
      fps: 30,
    });
    console.log(`✓ Created: ${output}\n`);
  } catch (error) {
    console.log(`✗ Error: ${error.message}\n`);
  }

  // Example 5: Batch conversion
  console.log('Example 5: Batch convert multiple GIFs');
  const gifFiles = ['animation1.gif', 'animation2.gif', 'animation3.gif'];

  for (const gifFile of gifFiles) {
    try {
      const output = await gif2vid(`./gifs/${gifFile}`, './videos/');
      console.log(`  ✓ Converted: ${gifFile} -> ${output}`);
    } catch (error) {
      console.log(`  ✗ Failed: ${gifFile} - ${error.message}`);
    }
  }
}

// Run examples
examples().catch(console.error);
