export function choosePrompt(language, english, chinese) {
  return language === 'en' ? english : chinese;
}
