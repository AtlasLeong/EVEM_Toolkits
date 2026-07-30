const ICP_NUMBER = '粤ICP备2024264329号'
const ICP_URL = 'https://beian.miit.gov.cn/'

export default function SiteFooter() {
  return (
    <footer className="site-footer">
      <a href={ICP_URL} target="_blank" rel="noreferrer">
        {ICP_NUMBER}
      </a>
    </footer>
  )
}
