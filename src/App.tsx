import { Gallery } from "@/gallery/Gallery"

export function App() {
  return (
    <div className="flex flex-col items-center gap-0 size-full p-0 ">
      {/* <div className="flex w-full items-center h-8 justify-start px-6">
      <h3 className="text-sm font-[300] text-secondary-foreground/80 ml-0 my-auto mr-auto "> Design engineering examples</h3>
      </div> */}
      <Gallery />
    </div>
  )
}

export default App
