import { AppError } from './errors.js';

export function readLanguage(library) {
  const stored = library.get('settings', 'language') || {};
  const interfaceLanguage = stored.interface === 'en' ? 'en' : 'zh';
  const generation = stored.generation === 'zh' || stored.generation === 'en' ? stored.generation : null;
  return { interface: interfaceLanguage, generation, effective: generation || interfaceLanguage };
}

export function saveLanguage(library, input) {
  const current = readLanguage(library);
  let interfaceLanguage = current.interface;
  if (Object.hasOwn(input, 'interface')) {
    if (input.interface !== 'zh' && input.interface !== 'en') throw new AppError('请选择界面语言。');
    interfaceLanguage = input.interface;
  }
  let generation = current.generation;
  if (Object.hasOwn(input, 'generation')) {
    if (input.generation == null || input.generation === 'follow') generation = null;
    else if (input.generation === 'zh' || input.generation === 'en') generation = input.generation;
    else throw new AppError('请选择生成语言。');
  }
  library.put('settings', {
    id: 'language', interface: interfaceLanguage, ...(generation ? { generation } : {}),
  });
  return readLanguage(library);
}
