import { describe, expect, it } from 'vitest'
import { forAi, imageToken, imagesIn, splitImages } from './images'

describe('images in text', () => {
  const text = `look ${imageToken('abc123')} and ${imageToken('zz9')} then ${imageToken('abc123')}`

  it('splits text and images in order', () => {
    expect(splitImages(`a${imageToken('x1')}b`)).toEqual([{ text: 'a' }, { id: 'x1' }, { text: 'b' }])
  })

  it('lists each image once', () => {
    expect(imagesIn(text)).toEqual(['abc123', 'zz9'])
  })

  it('leaves images from elsewhere alone', () => {
    expect(imagesIn('![x](https://evil.example/a.png) ![y](/api/data/../me/raw)')).toEqual([])
  })

  it('numbers images for an AI that reads text only', () => {
    expect(forAi(text)).toBe('look [image 1] and [image 2] then [image 1]\n\n(The images are Prolifica data; look at each with read_data: image 1 is abc123, image 2 is zz9.)')
    expect(forAi('no pictures')).toBe('no pictures')
  })
})
