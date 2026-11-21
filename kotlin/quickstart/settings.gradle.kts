rootProject.name = "audren-example-quickstart"

val audrenRepo = System.getenv("AUDREN_REPO_DIR")
    ?: file("../../../audren").canonicalPath
includeBuild("$audrenRepo/packages/kotlin")
